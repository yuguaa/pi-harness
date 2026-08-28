<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import {
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  Upload
} from '@lucide/vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { callApi, getApi } from '@renderer/composables/useApi'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import IconButton from '@renderer/components/ui/IconButton.vue'
import type { FileTreeEntry, GitFileStatusKind } from '@shared/types/workspace'
import { FILE_UPLOAD_MAX_BYTES } from '@shared/workspace/file-types'
import {
  STATUS_COLORS,
  STATUS_LABELS,
  buildFolderGitStatusMap,
  buildGitStatusMap,
  dirname
} from '@renderer/utils/git-decoration'

/**
 * 树形文件资源管理器。
 * 参考 orca 的 dirCache + expanded 懒加载模式：
 *  - dirCache 缓存「目录绝对路径 → 子节点」，展开目录时按需加载
 *  - expanded 记录展开状态，渲染时扁平化为可见行
 *  - git 变更文件 / 目录按状态着色，右侧显示 M/A/D/R/U/C 徽标
 */

interface TreeNode extends FileTreeEntry {
  depth: number
  /** git 已删除的幽灵条目（磁盘上不存在，仅用于提示）。 */
  ghost?: boolean
}

interface DirCacheEntry {
  children: TreeNode[]
  loading: boolean
  depth: number
}

const { t } = useI18n()
const workspace = useWorkspaceStore()
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

/** 根目录路径（项目根 / 当前 cwd）。 */
const rootPath = ref<string | null>(null)
/** 目录缓存：目录绝对路径 → 已加载子节点。 */
const dirCache = ref<Map<string, DirCacheEntry>>(new Map())
/** 展开状态集合。 */
const expanded = ref<Set<string>>(new Set())
let loadVersion = 0

const directoryName = computed(() => {
  const root = rootPath.value
  if (!root) return t('workspace.files')
  return (
    root
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || root
  )
})

/** 根目录加载中。 */
const rootLoading = computed(() =>
  rootPath.value ? dirCache.value.get(rootPath.value)?.loading === true : false
)

/* ---------- git 状态映射（computed 自动随 gitStatus 更新） ---------- */

const gitStatusMap = computed(() => buildGitStatusMap(workspace.gitStatus?.files ?? []))
const folderGitStatusMap = computed(() => buildFolderGitStatusMap(workspace.gitStatus?.files ?? []))

/** 节点状态：目录取聚合状态，文件取自身状态。 */
function nodeStatus(node: TreeNode): GitFileStatusKind | null {
  if (node.ghost) return 'deleted'
  if (node.isDirectory) return folderGitStatusMap.value.get(node.path) ?? null
  return gitStatusMap.value.get(node.path) ?? null
}

/* ---------- 目录读取 ---------- */

function basename(p: string): string {
  return (
    p
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? p
  )
}

/** 读取目录并把 git 已删除（磁盘上不存在）的文件补充为幽灵条目。 */
async function readDir(dir: string, depth: number): Promise<TreeNode[]> {
  const entries = await callApi(() => getApi().files.list(dir))
  const nodes: TreeNode[] = entries.map((entry) => ({ ...entry, depth }))
  const seen = new Set(nodes.map((node) => node.path))
  for (const file of workspace.gitStatus?.files ?? []) {
    if (file.status === 'deleted' && dirname(file.filePath) === dir && !seen.has(file.filePath)) {
      nodes.push({
        name: basename(file.filePath),
        path: file.filePath,
        isDirectory: false,
        depth,
        ghost: true
      })
    }
  }
  return nodes.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function setDirCache(dir: string, entry: DirCacheEntry) {
  dirCache.value = new Map(dirCache.value).set(dir, entry)
}

/* ---------- 根目录 ---------- */

async function loadRoot(force = false): Promise<void> {
  const root = workspace.currentCwd
  if (!root) {
    rootPath.value = null
    dirCache.value = new Map()
    expanded.value = new Set()
    return
  }
  if (!force && root === rootPath.value && dirCache.value.has(root)) return
  rootPath.value = root
  const version = ++loadVersion
  setDirCache(root, { children: [], loading: true, depth: 0 })
  try {
    const children = await readDir(root, 0)
    if (version !== loadVersion) return
    setDirCache(root, { children, loading: false, depth: 0 })
  } catch {
    if (version !== loadVersion) return
    setDirCache(root, { children: [], loading: false, depth: 0 })
  }
}

/* ---------- 展开 / 折叠 ---------- */

async function toggleDir(node: TreeNode): Promise<void> {
  const path = node.path
  if (expanded.value.has(path)) {
    const next = new Set(expanded.value)
    next.delete(path)
    expanded.value = next
    return
  }
  // 懒加载子目录
  const version = ++loadVersion
  const next = new Set(expanded.value)
  next.add(path)
  expanded.value = next
  setDirCache(path, {
    children: dirCache.value.get(path)?.children ?? [],
    loading: true,
    depth: node.depth + 1
  })
  try {
    const children = await readDir(path, node.depth + 1)
    if (version !== loadVersion) return
    setDirCache(path, { children, loading: false, depth: node.depth + 1 })
  } catch {
    if (version !== loadVersion) return
    setDirCache(path, { children: [], loading: false, depth: node.depth + 1 })
  }
}

function onRowClick(node: TreeNode): void {
  if (node.isDirectory) {
    void toggleDir(node)
    return
  }
  workspace.showInspectorFile(node.path)
}

/* ---------- 渲染：树扁平化为可见行 ---------- */

const visibleRows = computed<TreeNode[]>(() => {
  const rows: TreeNode[] = []
  const walk = (dir: string) => {
    for (const child of dirCache.value.get(dir)?.children ?? []) {
      rows.push(child)
      if (child.isDirectory && expanded.value.has(child.path)) {
        walk(child.path)
      }
    }
  }
  if (rootPath.value) walk(rootPath.value)
  return rows
})

function dirLoading(node: TreeNode): boolean {
  return node.isDirectory && dirCache.value.get(node.path)?.loading === true
}

/* ---------- 刷新 ---------- */

/** 强制重载根目录与所有展开目录（保留旧内容，避免闪烁）。 */
async function refreshTree(): Promise<void> {
  if (!rootPath.value) {
    void loadRoot(true)
    return
  }
  const version = ++loadVersion
  const dirs = [rootPath.value, ...expanded.value]
  await Promise.all(
    dirs.map(async (dir) => {
      const entry = dirCache.value.get(dir)
      if (!entry) return
      try {
        const children = await readDir(dir, entry.depth)
        if (version !== loadVersion) return
        setDirCache(dir, { children, loading: false, depth: entry.depth })
      } catch {
        /* 目录可能已失效，保留旧缓存由用户手动重试 */
      }
    })
  )
}

watch(
  () => workspace.currentCwd,
  () => {
    void loadRoot(true)
  },
  { immediate: true }
)

watch(
  () => workspace.contentRevision,
  () => {
    void refreshTree()
  }
)

/* ---------- 上传 ---------- */

function chooseFiles() {
  fileInput.value?.click()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = Array.from(input.files ?? [])
  const targetDirectory = rootPath.value
  if (!selected.length || !targetDirectory || uploading.value) {
    input.value = ''
    return
  }

  const oversized = selected.filter((file) => file.size > FILE_UPLOAD_MAX_BYTES)
  if (oversized.length) {
    toast.warning(t('workspace.uploadTooLarge', { size: FILE_UPLOAD_MAX_BYTES / 1024 / 1024 }))
  }

  const files = selected.filter((file) => file.size <= FILE_UPLOAD_MAX_BYTES)
  if (!files.length) {
    input.value = ''
    return
  }

  uploading.value = true
  let uploaded = 0
  let currentName = ''
  try {
    for (const file of files) {
      currentName = file.name
      const base64 = await readFileBase64(file)
      try {
        await uploadFile(targetDirectory, file.name, base64, false)
        uploaded += 1
      } catch (error) {
        if (isFileExistsError(error)) {
          const replace = await askConfirm({
            title: t('workspace.overwriteFileTitle'),
            description: t('workspace.overwriteFileConfirm', { name: file.name }),
            confirmLabel: t('workspace.overwriteFileAction'),
            tone: 'primary'
          })
          if (!replace) continue
          await uploadFile(targetDirectory, file.name, base64, true)
          uploaded += 1
          continue
        }
        throw error
      }
    }
  } catch (error) {
    toast.error(
      t('workspace.uploadFailed', {
        name: currentName,
        message: errorMessage(error)
      })
    )
  } finally {
    uploading.value = false
    input.value = ''
  }

  if (uploaded > 0) {
    await workspace.refreshContent(targetDirectory)
    toast.success(t('workspace.uploadComplete', { count: uploaded }))
  }
}

async function uploadFile(directory: string, fileName: string, base64: string, overwrite: boolean) {
  await callApi(() => getApi().files.upload(directory, fileName, base64, overwrite))
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read file'))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const separator = result.indexOf(',')
      if (separator === -1) {
        reject(new Error('Unable to read file'))
        return
      }
      resolve(result.slice(separator + 1))
    }
    reader.readAsDataURL(file)
  })
}

function isFileExistsError(error: unknown): boolean {
  return errorMessage(error).includes('File already exists')
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return error instanceof Error ? error.message : String(error)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- 头部工具栏（固定） -->
    <div
      class="flex h-8 shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-sidebar)] px-1.5"
    >
      <span
        class="min-w-0 flex-1 truncate px-1 text-[10.5px] text-[var(--text-tertiary)]"
        :title="rootPath ?? ''"
      >
        {{ directoryName }}
      </span>
      <IconButton
        :label="$t('workspace.uploadFiles')"
        :disabled="!rootPath || uploading"
        @click="chooseFiles"
      >
        <LoaderCircle v-if="uploading" class="size-3.5 animate-spin" :stroke-width="1.75" />
        <Upload v-else class="size-3.5" :stroke-width="1.75" />
      </IconButton>
      <IconButton
        :label="$t('workspace.refreshFiles')"
        :disabled="!rootPath"
        @click="workspace.refreshContent()"
      >
        <RefreshCw class="size-3.5" :stroke-width="1.75" />
      </IconButton>
      <input
        ref="fileInput"
        data-testid="file-upload-input"
        type="file"
        multiple
        class="hidden"
        @change="onFileChange"
      />
    </div>

    <!-- 树形列表（超出可滚动） -->
    <div class="min-h-0 flex-1 overflow-y-auto">
      <ul class="px-1 py-1">
        <li v-for="node in visibleRows" :key="node.path">
          <button
            class="flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            :style="{ paddingLeft: `${node.depth * 14 + 8}px` }"
            @click="onRowClick(node)"
          >
            <template v-if="node.isDirectory">
              <ChevronRight
                class="size-3.5 shrink-0 text-[var(--text-tertiary)] transition-transform duration-100"
                :class="expanded.has(node.path) ? 'rotate-90' : ''"
                :stroke-width="1.75"
              />
              <LoaderCircle
                v-if="dirLoading(node)"
                class="size-3.5 shrink-0 animate-spin text-[var(--text-tertiary)]"
                :stroke-width="1.75"
              />
              <FolderOpen
                v-else-if="expanded.has(node.path)"
                class="size-3.5 shrink-0 text-[var(--text-tertiary)]"
                :stroke-width="1.75"
              />
              <Folder
                v-else
                class="size-3.5 shrink-0 text-[var(--text-tertiary)]"
                :stroke-width="1.75"
              />
            </template>
            <File
              v-else
              class="size-3.5 shrink-0 text-[var(--text-tertiary)]"
              :stroke-width="1.75"
            />
            <span
              class="min-w-0 flex-1 truncate"
              :class="node.ghost ? 'italic line-through' : ''"
              :style="
                nodeStatus(node)
                  ? { color: STATUS_COLORS[nodeStatus(node) as GitFileStatusKind] }
                  : undefined
              "
            >
              {{ node.name }}
            </span>
            <span
              v-if="nodeStatus(node)"
              class="shrink-0 text-[10px] font-semibold tracking-wide"
              :style="{ color: STATUS_COLORS[nodeStatus(node) as GitFileStatusKind] }"
            >
              {{ STATUS_LABELS[nodeStatus(node) as GitFileStatusKind] }}
            </span>
          </button>
        </li>
        <li
          v-if="rootPath && !rootLoading && visibleRows.length === 0"
          class="px-2 py-4 text-center text-[11px] text-[var(--text-tertiary)]"
        >
          {{ $t('workspace.noFiles') }}
        </li>
      </ul>
    </div>
  </div>
</template>
