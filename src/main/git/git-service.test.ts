import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import path from 'node:path'
import { FileAccessService } from '../files/file-access-service'
import { GitService } from './git-service'

const execFileAsync = promisify(execFile)

describe.skipIf(process.platform === 'win32')('GitService mutations', () => {
  let root = ''
  let service: GitService
  let tempPaths: string[] = []

  beforeEach(async () => {
    tempPaths = []
    root = await tempPath('pi-harness-git-service-')
    const access = new FileAccessService()
    access.allowRoot(root)
    service = new GitService(access)

    await runGit(['init', '-q', '-b', 'main'])
    await runGit(['config', 'user.name', 'Pi Harness Test'])
    await runGit(['config', 'user.email', 'pi-harness-test@example.com'])
    await writeFile(path.join(root, 'README.md'), 'initial\n')
    await runGit(['add', '--', 'README.md'])
    await runGit(['commit', '-q', '-m', 'initial'])
  })

  afterEach(async () => {
    await Promise.all(tempPaths.map((entry) => rm(entry, { recursive: true, force: true })))
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

  it('lists and switches local branches', async () => {
    await runGit(['branch', 'feature'])

    await expect(service.branches(root)).resolves.toMatchObject({
      currentBranch: 'main',
      detached: false,
      branches: expect.arrayContaining([
        expect.objectContaining({ name: 'main', current: true, remote: false }),
        expect.objectContaining({ name: 'feature', current: false, remote: false })
      ])
    })

    await service.switchBranch(root, 'feature', false)
    await expect(service.branches(root)).resolves.toMatchObject({ currentBranch: 'feature' })
  })

  it('leaves dirty worktree changes intact when branch switching is rejected', async () => {
    await runGit(['switch', '-c', 'feature'])
    await writeFile(path.join(root, 'README.md'), 'feature\n')
    await runGit(['add', '--', 'README.md'])
    await runGit(['commit', '-q', '-m', 'feature'])
    await runGit(['switch', 'main'])
    await writeFile(path.join(root, 'README.md'), 'dirty main\n')

    await expect(service.switchBranch(root, 'feature', false)).rejects.toMatchObject({
      code: 'GIT_ERROR'
    })
    await expect(readFile(path.join(root, 'README.md'), 'utf8')).resolves.toBe('dirty main\n')
  })

  it('pushes with upstream setup when the repository has one remote', async () => {
    const remote = await createBareRemote()
    await runGit(['remote', 'add', 'origin', remote])

    await service.push(root)

    await expect(service.branches(root)).resolves.toMatchObject({
      currentBranch: 'main',
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
      remotes: ['origin']
    })
  })

  it('fetches remote branches and creates a local tracking branch', async () => {
    const remote = await createBareRemote()
    await runGit(['remote', 'add', 'origin', remote])
    await service.push(root)
    const clone = await cloneRemote(remote)
    await runGitAt(clone, ['switch', '-c', 'remote-only'])
    await writeFile(path.join(clone, 'remote.txt'), 'remote\n')
    await runGitAt(clone, ['add', '--', 'remote.txt'])
    await runGitAt(clone, ['commit', '-q', '-m', 'remote branch'])
    await runGitAt(clone, ['push', '-q', '-u', 'origin', 'remote-only'])

    await service.fetch(root)
    await expect(service.branches(root)).resolves.toMatchObject({
      branches: expect.arrayContaining([
        expect.objectContaining({ name: 'origin/remote-only', remote: true })
      ])
    })

    await service.switchBranch(root, 'origin/remote-only', true)
    await expect(service.branches(root)).resolves.toMatchObject({
      currentBranch: 'remote-only',
      upstream: 'origin/remote-only'
    })
  })

  it('pulls a fast-forward update from the configured upstream', async () => {
    const remote = await createBareRemote()
    await runGit(['remote', 'add', 'origin', remote])
    await service.push(root)
    const clone = await cloneRemote(remote)
    await writeFile(path.join(clone, 'README.md'), 'remote update\n')
    await runGitAt(clone, ['add', '--', 'README.md'])
    await runGitAt(clone, ['commit', '-q', '-m', 'remote update'])
    await runGitAt(clone, ['push', '-q'])

    await service.fetch(root)
    await expect(service.branches(root)).resolves.toMatchObject({ behind: 1 })
    await service.pull(root)

    await expect(readFile(path.join(root, 'README.md'), 'utf8')).resolves.toBe('remote update\n')
    await expect(service.branches(root)).resolves.toMatchObject({ ahead: 0, behind: 0 })
  })

  async function tempPath(prefix: string): Promise<string> {
    const created = await mkdtemp(path.join(tmpdir(), prefix))
    tempPaths.push(created)
    return created
  }

  async function createBareRemote(): Promise<string> {
    const remote = await tempPath('pi-harness-git-remote-')
    await runGitAt(remote, ['init', '--bare', '-q', '-b', 'main'])
    return remote
  }

  async function cloneRemote(remote: string): Promise<string> {
    const parent = await tempPath('pi-harness-git-clone-')
    const clone = path.join(parent, 'repo')
    await execFileAsync('git', ['clone', '-q', remote, clone])
    await runGitAt(clone, ['config', 'user.name', 'Pi Harness Test'])
    await runGitAt(clone, ['config', 'user.email', 'pi-harness-test@example.com'])
    return clone
  }

  function runGit(args: string[]) {
    return runGitAt(root, args)
  }

  function runGitAt(cwd: string, args: string[]) {
    return execFileAsync('git', ['-C', cwd, ...args], {
      env: { ...process.env, LC_ALL: 'C' }
    })
  }
})
