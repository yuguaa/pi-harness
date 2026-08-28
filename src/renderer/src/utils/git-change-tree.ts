import { getDominantStatus } from './git-decoration'
import type { GitFileStatus, GitFileStatusKind } from '@shared/types/workspace'

/**
 * Git 变更树构建工具。
 * 参考 orca 的 source-control-tree 模式，将变更文件按目录树分组，
 * 支持目录折叠展开与单子目录链压缩（VS Code 风格）。
 */

export interface GitChangeFileNode {
  type: 'file'
  key: string
  /** 文件名。 */
  name: string
  /** 相对仓库根目录的路径。 */
  relPath: string
  file: GitFileStatus
  depth: number
}

export interface GitChangeDirNode {
  type: 'directory'
  key: string
  name: string
  relPath: string
  depth: number
  fileCount: number
  /** 目录主导状态（含子文件/子目录聚合）。 */
  status: GitFileStatusKind | null
  children: GitChangeNode[]
}

export type GitChangeNode = GitChangeFileNode | GitChangeDirNode

/** 目录节点（可变构建阶段）。 */
interface MutableDirNode {
  type: 'directory'
  key: string
  name: string
  relPath: string
  depth: number
  fileCount: number
  status: GitFileStatusKind | null
  children: GitChangeNode[]
  dirChildren: Map<string, MutableDirNode>
}

function makeDirNode(namespace: string, relPath: string, name: string, depth: number): MutableDirNode {
  return {
    type: 'directory',
    key: `dir::${namespace}::${relPath}`,
    name,
    relPath,
    depth,
    fileCount: 0,
    status: null,
    children: [],
    dirChildren: new Map()
  }
}

function finalizeDirNode(node: MutableDirNode): GitChangeDirNode {
  const directories: GitChangeDirNode[] = []
  const files: GitChangeFileNode[] = []

  for (const child of node.children) {
    if (child.type === 'directory') {
      directories.push(finalizeDirNode(child as MutableDirNode))
    } else {
      files.push(child)
    }
  }

  directories.sort((a, b) => a.name.localeCompare(b.name))
  files.sort((a, b) => a.name.localeCompare(b.name))

  const fileCount = files.length + directories.reduce((sum, d) => sum + d.fileCount, 0)
  const status =
    getDominantStatus([
      ...files.map((f) => f.file.status),
      ...directories.flatMap((d) => (d.status ? [d.status] : []))
    ]) ?? null

  return {
    type: 'directory',
    key: node.key,
    name: node.name,
    relPath: node.relPath,
    depth: node.depth,
    fileCount,
    status,
    children: [...directories, ...files]
  }
}

/**
 * 从变更文件列表构建目录树（绝对路径 → 相对路径拆解）。
 * @param repositoryRoot 仓库根目录（用于计算相对路径）
 * @param files 变更文件列表
 * @param namespace 分区命名空间（不同分区共享折叠状态时隔离 key）
 */
export function buildGitChangeTree(
  repositoryRoot: string,
  files: GitFileStatus[],
  namespace = ''
): GitChangeNode[] {
  const root = makeDirNode(namespace, '', '', -1)

  for (const file of files) {
    const relPath = file.filePath.replace(/[\\/]+$/, '').replace(/\\/g, '/')
      .startsWith(repositoryRoot.replace(/\\/g, '/'))
      ? file.filePath.slice(repositoryRoot.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
      : file.filePath.replace(/\\/g, '/')

    const segments = relPath.split('/').filter(Boolean)
    if (!segments.length) continue

    let parent = root
    for (let i = 0; i < segments.length - 1; i++) {
      const name = segments[i]
      const path = segments.slice(0, i + 1).join('/')
      let dir = parent.dirChildren.get(name)
      if (!dir) {
        dir = makeDirNode(namespace, path, name, i)
        parent.dirChildren.set(name, dir)
        parent.children.push(dir)
      }
      parent = dir
    }

    const fileName = segments[segments.length - 1]
    parent.children.push({
      type: 'file',
      key: `${namespace}::${file.filePath}`,
      name: fileName,
      relPath,
      file,
      depth: segments.length - 1
    })
  }

  return finalizeDirNode(root).children
}

/**
 * 压缩单子目录链 —— 连续的单目录层被合并到父节点名称中。
 * 如 `src/components/Button.tsx` 只有这一个文件，压缩后显示为
 * `src/components/Button.tsx` 直接放在根层级。
 */
export function compactGitChangeTree(nodes: GitChangeNode[], depth = 0): GitChangeNode[] {
  return nodes.map((node) => {
    if (node.type === 'file') return { ...node, depth }
    const dir = node as GitChangeDirNode
    // 压缩单子目录链
    const names = [dir.name]
    let compacted: GitChangeDirNode = dir
    while (compacted.children.length === 1 && compacted.children[0]?.type === 'directory') {
      const child = compacted.children[0] as GitChangeDirNode
      names.push(child.name)
      compacted = child
    }
    return {
      ...compacted,
      name: names.join('/'),
      depth,
      children: compactGitChangeTree(compacted.children, depth + 1)
    } as GitChangeDirNode
  })
}

/**
 * 将树扁平化为可见行列表（展开的目录递归展开，折叠的目录停住）。
 */
export function flattenGitChangeTree(
  nodes: GitChangeNode[],
  collapsed: Set<string>
): GitChangeNode[] {
  const result: GitChangeNode[] = []
  const walk = (node: GitChangeNode): void => {
    result.push(node)
    if (node.type === 'directory' && !collapsed.has(node.key)) {
      for (const child of node.children) walk(child)
    }
  }
  for (const node of nodes) walk(node)
  return result
}

/** 获取目录名（用于显示）。 */
export function dirName(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
}