import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import path from 'node:path'
import { FileAccessService } from '../files/file-access-service'
import { GitService } from './git-service'

const execFileAsync = promisify(execFile)

describe.skipIf(process.platform === 'win32')('GitService mutations', () => {
  let root = ''
  let service: GitService

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pi-harness-git-service-'))
    const access = new FileAccessService()
    access.allowRoot(root)
    service = new GitService(access)

    await runGit(['init', '-q'])
    await runGit(['config', 'user.name', 'Pi Harness Test'])
    await runGit(['config', 'user.email', 'pi-harness-test@example.com'])
    await writeFile(path.join(root, 'README.md'), 'initial\n')
    await runGit(['add', '--', 'README.md'])
    await runGit(['commit', '-q', '-m', 'initial'])
  })

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('stages and unstages selected files without shell interpolation', async () => {
    const filePath = path.join(root, 'README.md')
    await writeFile(filePath, 'changed\n')

    await service.stage(root, [filePath])
    let status = await service.status(root)
    expect(status.files[0]).toMatchObject({ indexStatus: 'M', worktreeStatus: ' ' })

    await service.unstage(root, [filePath])
    status = await service.status(root)
    expect(status.files[0]).toMatchObject({ indexStatus: ' ', worktreeStatus: 'M' })
  })

  it('creates a commit from the staged index', async () => {
    const filePath = path.join(root, 'README.md')
    await writeFile(filePath, 'committed\n')
    await service.stage(root, [filePath])

    await service.commit(root, 'update readme')

    await expect(service.status(root)).resolves.toMatchObject({ files: [] })
    await expect(runGit(['log', '-1', '--pretty=%s'])).resolves.toMatchObject({
      stdout: 'update readme\n'
    })
  })

  it('unstages a file before the repository has its first commit', async () => {
    const filePath = path.join(root, 'README.md')
    await runGit(['checkout', '--orphan', 'unborn'])
    await runGit(['rm', '-r', '--cached', '--', '.'])
    await writeFile(filePath, 'first commit\n')
    await service.stage(root, [filePath])

    await service.unstage(root, [filePath])

    await expect(runGit(['status', '--porcelain'])).resolves.toMatchObject({
      stdout: expect.stringContaining('?? README.md')
    })
  })

  it('rejects mutation paths outside the repository root', async () => {
    const outsidePath = path.join(root, '..', 'outside.txt')
    await expect(service.stage(root, [outsidePath])).rejects.toMatchObject({ code: 'PATH_DENIED' })
  })

  function runGit(args: string[]) {
    return execFileAsync('git', ['-C', root, ...args], {
      env: { ...process.env, LC_ALL: 'C' }
    })
  }
})
