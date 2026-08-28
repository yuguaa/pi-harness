import type { GitFileStatus, GitFileStatusKind } from '@shared/types/workspace'

/**
 * Git 状态装饰工具 —— 为文件树提供状态标签、颜色与目录聚合。
 * 移植自 orca 的 status-display，路径基于绝对路径（gitStatus.files 的 filePath）。
 */

/** 状态徽标（对齐 VS Code / orca 的 M/A/D/R/U 缩写）。 */
export const STATUS_LABELS: Record<GitFileStatusKind, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflict: 'C'
}

/** 状态颜色 —— 引用 tokens.css 中的 --git-decoration-* 变量，主题自动切换。 */
export const STATUS_COLORS: Record<GitFileStatusKind, string> = {
  modified: 'var(--git-decoration-modified)',
  added: 'var(--git-decoration-added)',
  deleted: 'var(--git-decoration-deleted)',
  renamed: 'var(--git-decoration-renamed)',
  untracked: 'var(--git-decoration-untracked)',
  conflict: 'var(--git-decoration-deleted)'
}

/** 目录聚合优先级：冲突 > 删除 > 修改 > 新增 > 未跟踪 > 重命名。 */
const STATUS_PRIORITY: Record<GitFileStatusKind, number> = {
  conflict: 6,
  deleted: 5,
  modified: 4,
  added: 3,
  untracked: 3,
  renamed: 2
}

/** 取一组状态中优先级最高者。 */
export function getDominantStatus(statuses: Iterable<GitFileStatusKind>): GitFileStatusKind | null {
  let dominant: GitFileStatusKind | null = null
  let dominantPriority = -1
  for (const status of statuses) {
    const priority = STATUS_PRIORITY[status]
    if (priority > dominantPriority) {
      dominant = status
      dominantPriority = priority
    }
  }
  return dominant
}

/** 文件级状态映射：绝对路径 → 状态。 */
export function buildGitStatusMap(entries: GitFileStatus[]): Map<string, GitFileStatusKind> {
  const statusByPath = new Map<string, GitFileStatusKind>()
  for (const entry of entries) {
    const existing = statusByPath.get(entry.filePath)
    const resolved = existing
      ? (getDominantStatus([existing, entry.status]) ?? entry.status)
      : entry.status
    statusByPath.set(entry.filePath, resolved)
  }
  return statusByPath
}

/** 删除的文件不参与目录聚合（磁盘上已不存在，不会出现在目录缓存中）。 */
function shouldPropagateStatus(status: GitFileStatusKind): boolean {
  return status !== 'deleted'
}

/**
 * 目录级状态映射：绝对目录路径 → 聚合状态。
 * 对每个可列出文件的变更状态逐级向上传播到祖先目录，
 * 保证目录在含变更文件时同样着色（VS Code 行为）。
 */
export function buildFolderGitStatusMap(
  entries: GitFileStatus[]
): Map<string, GitFileStatusKind> {
  const folderStatuses = new Map<string, GitFileStatusKind[]>()
  for (const entry of entries) {
    if (!shouldPropagateStatus(entry.status)) continue
    let current = entry.filePath
    for (;;) {
      const parent = dirname(current)
      if (!parent || parent === current) break
      const list = folderStatuses.get(parent)
      if (list) list.push(entry.status)
      else folderStatuses.set(parent, [entry.status])
      current = parent
    }
  }
  const result = new Map<string, GitFileStatusKind>()
  for (const [folderPath, statuses] of folderStatuses) {
    const dominant = getDominantStatus(statuses)
    if (dominant) result.set(folderPath, dominant)
  }
  return result
}

/** 取路径的父目录（跨平台，兼容尾部分隔符）。 */
export function dirname(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '')
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (slash <= 0) return trimmed.startsWith('/') ? '/' : ''
  const parent = trimmed.slice(0, slash)
  return /^[a-zA-Z]:$/.test(parent) ? `${parent}\\` : parent
}
