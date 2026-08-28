import path from 'node:path'
import { gitExec } from './git-exec'
import type { FileAccessService } from '../files/file-access-service'
import type { GitFileDiffResponse, GitStatusResponse } from '@shared/types/workspace'
import { GitError } from '../services/errors'
import { classifyGitStatus, parseGitPorcelainV1 } from '@shared/workspace/git-status'
import { TEXT_PREVIEW_MAX_BYTES } from '@shared/workspace/file-types'
import { isPathWithin } from '@shared/workspace/path-security'
import { toNativePath } from '@shared/workspace/paths'
import { readFile, realpath, stat } from 'node:fs/promises'

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

export class GitService {
  constructor(private readonly access: FileAccessService) {}

  async status(cwd: string): Promise<GitStatusResponse> {
    const realCwd = await this.access.assertAllowed(cwd, { mustExist: true })
    let repositoryRoot: string | null = null
    try {
      repositoryRoot = toNativePath(
        (await gitExec(realCwd, ['rev-parse', '--show-toplevel'])).trim()
      )
    } catch {
      return { isGitRepository: false, repositoryRoot: null, files: [], additions: 0, deletions: 0 }
    }
    if (!repositoryRoot) {
      return { isGitRepository: false, repositoryRoot: null, files: [], additions: 0, deletions: 0 }
    }

    const [porcelain, numstat] = await Promise.all([
      gitExec(repositoryRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      gitExec(repositoryRoot, [
        'diff',
        '--no-color',
        '--no-ext-diff',
        '--numstat',
        'HEAD',
        '--',
        '.'
      ]).catch(() => '')
    ])

    const entries = parseGitPorcelainV1(porcelain)
    const files = entries.flatMap((entry) => {
      const filePath = path.resolve(repositoryRoot!, entry.path)
      if (!isPathWithin(filePath, realCwd) && !isPathWithin(filePath, repositoryRoot!)) return []
      const classified = classifyGitStatus(entry)
      return [
        {
          filePath,
          ...classified,
          indexStatus: entry.indexStatus,
          worktreeStatus: entry.worktreeStatus
        }
      ]
    })

    let additions = 0
    let deletions = 0
    for (const line of numstat.split(/\r?\n/)) {
      if (!line) continue
      const [added, deleted] = line.split('\t', 2)
      const addedCount = Number(added)
      const deletedCount = Number(deleted)
      if (Number.isInteger(addedCount)) additions += addedCount
      if (Number.isInteger(deletedCount)) deletions += deletedCount
    }

    return { isGitRepository: true, repositoryRoot, files, additions, deletions }
  }

  async diff(cwd: string, filePath: string): Promise<GitFileDiffResponse> {
    const realCwd = await this.access.assertAllowed(cwd, { mustExist: true })
    const realFile = await this.access.assertAllowed(filePath)
    let repositoryRoot: string
    try {
      repositoryRoot = toNativePath(
        (await gitExec(realCwd, ['rev-parse', '--show-toplevel'])).trim()
      )
    } catch {
      return { supported: false }
    }
    if (!isPathWithin(realFile, repositoryRoot)) return { supported: false }

    const relativePath = toGitPath(path.relative(repositoryRoot, realFile))
    const porcelain = await gitExec(repositoryRoot, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all'
    ])
    const entries = parseGitPorcelainV1(porcelain)
    const entry = entries.find((candidate) => candidate.path === relativePath)
    if (!entry) return { supported: false }
    const classified = classifyGitStatus(entry)

    if (classified.status === 'untracked') {
      try {
        const st = await stat(realFile)
        if (!st.isFile() || st.size > TEXT_PREVIEW_MAX_BYTES) {
          return { supported: true, status: classified.status, patch: '' }
        }
        const content = await readFile(realFile, 'utf8')
        return {
          supported: true,
          status: classified.status,
          patch: createAddedFilePatch(relativePath, content)
        }
      } catch {
        return { supported: true, status: classified.status, patch: '' }
      }
    }

    try {
      const patch = await gitExec(
        repositoryRoot,
        ['diff', '--no-color', '--no-ext-diff', '--unified=3', 'HEAD', '--', relativePath],
        { maxBuffer: TEXT_PREVIEW_MAX_BYTES * 4 }
      )
      return { supported: true, status: classified.status, patch }
    } catch {
      return { supported: true, status: classified.status, patch: '' }
    }
  }

  async showFile(cwd: string, filePath: string): Promise<{ content: string | null }> {
    const realCwd = await this.access.assertAllowed(cwd, { mustExist: true })
    const realFile = await this.access.assertAllowed(filePath)
    let repositoryRoot: string
    try {
      repositoryRoot = toNativePath(
        (await gitExec(realCwd, ['rev-parse', '--show-toplevel'])).trim()
      )
    } catch {
      return { content: null }
    }
    if (!isPathWithin(realFile, repositoryRoot)) return { content: null }

    const relativePath = toGitPath(path.relative(repositoryRoot, realFile))
    try {
      const content = await gitExec(repositoryRoot, ['show', `HEAD:${relativePath}`], {
        maxBuffer: TEXT_PREVIEW_MAX_BYTES * 4
      })
      return { content }
    } catch {
      return { content: null }
    }
  }

  async stage(cwd: string, filePaths: string[]): Promise<void> {
    const { repositoryRoot, relativePaths } = await this.resolveMutation(cwd, filePaths)
    await gitExec(repositoryRoot, ['add', '--', ...relativePaths])
  }

  async unstage(cwd: string, filePaths: string[]): Promise<void> {
    const { repositoryRoot, relativePaths } = await this.resolveMutation(cwd, filePaths)
    try {
      await gitExec(repositoryRoot, ['restore', '--staged', '--', ...relativePaths])
    } catch (error) {
      // 初始分支还没有 HEAD 时，restore --staged 无法解析 HEAD，改用 rm --cached 保留工作区文件。
      try {
        await gitExec(repositoryRoot, ['rm', '--cached', '--', ...relativePaths])
      } catch {
        throw error
      }
    }
  }

  async commit(cwd: string, message: string): Promise<void> {
    const realCwd = await this.access.assertAllowed(cwd, { mustExist: true })
    const repositoryRoot = await this.resolveRepositoryRoot(realCwd)
    const normalizedMessage = message.trim()
    if (!normalizedMessage) throw new GitError('Commit message is required')
    await gitExec(repositoryRoot, ['commit', '-m', normalizedMessage])
  }

  private async resolveMutation(
    cwd: string,
    filePaths: string[]
  ): Promise<{ repositoryRoot: string; relativePaths: string[] }> {
    const realCwd = await this.access.assertAllowed(cwd, { mustExist: true })
    const repositoryRoot = await this.resolveRepositoryRoot(realCwd)
    const relativePaths = new Set<string>()

    for (const filePath of filePaths) {
      const allowedPath = await this.access.assertAllowed(filePath)
      const resolvedPath = await canonicalizeGitPath(allowedPath)
      if (!isPathWithin(resolvedPath, repositoryRoot)) {
        throw new GitError('Git path is outside the repository', { filePath })
      }
      const relativePath = path.relative(repositoryRoot, resolvedPath)
      if (!relativePath) throw new GitError('Git path must reference a file', { filePath })
      relativePaths.add(toGitPath(relativePath))
    }

    if (!relativePaths.size) throw new GitError('No Git paths provided')
    return { repositoryRoot, relativePaths: [...relativePaths] }
  }

  private async resolveRepositoryRoot(cwd: string): Promise<string> {
    try {
      const repositoryRoot = toNativePath(
        (await gitExec(cwd, ['rev-parse', '--show-toplevel'])).trim()
      )
      if (repositoryRoot) return repositoryRoot
    } catch {
      /* 统一转换为 GitError，避免把子进程错误细节泄漏到调用方。 */
    }
    throw new GitError('Not a Git repository', { cwd })
  }
}

async function canonicalizeGitPath(filePath: string): Promise<string> {
  const resolvedPath = path.resolve(filePath)
  try {
    return await realpath(resolvedPath)
  } catch {
    // 删除中的文件无法 realpath，仍需解析其父目录中的符号链接。
    try {
      return path.join(await realpath(path.dirname(resolvedPath)), path.basename(resolvedPath))
    } catch {
      return resolvedPath
    }
  }
}

function createAddedFilePatch(gitPath: string, content: string): string {
  const hasTrailingNewline = content.endsWith('\n')
  const lines = content.split('\n')
  if (hasTrailingNewline) lines.pop()
  const body = lines.map((line) => `+${line}`).join('\n')
  const noNewlineMarker =
    !hasTrailingNewline && lines.length > 0 ? '\n\\ No newline at end of file' : ''
  return [
    `diff --git a/${gitPath} b/${gitPath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${gitPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    `${body}${noNewlineMarker}`
  ].join('\n')
}
