// dsh-dev-backup — Client half.
//
// Renders one Settings page that answers "is my backup still fresh?" and keeps asking the
// Host half's route while it is open. Every module id below must equal the package name:
// the Harness indexes the client module table by package name.
window.__ModuleLoader__.load({
  id: 'dsh-dev-backup',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { jsx, jsxs } = require('react/jsx-runtime')
    const React = require('react')

    const styleId = 'dsh-dev-backup/client.css'
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css=${JSON.stringify(styleId)}]`) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-dev-backup'
      tag.dataset.pluginCss = styleId
      tag.textContent = `
        .dshBackupSection{box-sizing:border-box;max-width:760px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:16px}
        .dshBackupHeading{margin:0;font-size:18px;font-weight:600;line-height:28px}
        .dshBackupIntro{margin:0;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px}
        .dshBackupCard{display:flex;align-items:flex-start;gap:16px;padding:18px 20px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}
        .dshBackupDot{flex:none;width:12px;height:12px;margin-top:6px;border-radius:50%;background:var(--dsw-alias-label-secondary)}
        .dshBackupDot[data-level=ok]{background:var(--dsw-alias-state-success,#22c55e)}
        .dshBackupDot[data-level=warn]{background:var(--dsw-alias-state-warning,#f59e0b)}
        .dshBackupDot[data-level=bad]{background:var(--dsw-alias-state-danger,#ef4444)}
        .dshBackupCopy{min-width:0;display:flex;flex:1;flex-direction:column;gap:4px}
        .dshBackupLabel{font-size:15px;font-weight:600;line-height:24px}
        .dshBackupMeta{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
        .dshBackupReasons{margin:6px 0 0;padding-left:18px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px}
        .dshBackupRows{display:flex;flex-direction:column;gap:10px}
        .dshBackupRow{display:flex;gap:12px;align-items:baseline;font-size:13px;line-height:20px}
        .dshBackupRowKey{flex:none;width:132px;color:var(--dsw-alias-label-secondary)}
        .dshBackupRowValue{min-width:0;flex:1;word-break:break-word}
        .dshBackupMono{font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:18px;white-space:pre-wrap}
        .dshBackupActions{display:flex;align-items:center;gap:12px}
        .dshBackupButton{box-sizing:border-box;height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer}
        .dshBackupButton:hover{background:var(--dsw-alias-bg-layer-2)}
        .dshBackupButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      `
      document.head.appendChild(tag)
    }

    const dictionaries = {
      zh: {
        nav: '备份',
        title: '冷备新鲜度',
        intro: '查看定时备份是否真的跑过、最近一次成功是什么时候。数据来自 Host 半侧读取的状态文件与 launchd 任务。',
        levelOk: '正常',
        levelWarn: '需要留意',
        levelBad: '有问题',
        levelUnknown: '尚未配置',
        refresh: '立即刷新',
        updatedAt: '更新于',
        loading: '正在读取状态…',
        unreachable: '拿不到状态：Host 半侧的路由没有响应。',
        notConfigured: '还没有配置备份源。到「设置 → 插件」里给 dsh-dev-backup 填上状态文件路径，或指定一个 launchd 任务。',
        lastSuccess: '最近成功',
        age: '距今',
        launchd: 'launchd 任务',
        launchdUnsupported: '当前平台不支持 launchd',
        failure: '最近失败',
        command: '状态命令',
        exitCode: '退出码',
        never: '从未',
        hoursAgo: '{n} 小时前',
        minutesAgo: '{n} 分钟前',
        justNow: '刚刚',
        reasonStale: '上次成功已超过 {n} 小时',
        reasonMissing: '状态文件不存在：{path}',
        reasonUnreadable: '状态文件读不出来：{path}',
        reasonLaunchdNotLoaded: 'launchd 任务未加载：{label}',
        reasonLaunchdFailed: 'launchd 上次退出码为 {code}',
        reasonFailureNewer: '最近一次失败没有被后来的成功盖过（该次运行有问题）',
        reasonCommandFailed: '状态命令退出码为 {code}',
        reasonUnconfigured: '未配置任何备份源',
      },
      en: {
        nav: 'Backup',
        title: 'Backup freshness',
        intro: 'See whether the scheduled backup actually ran and when it last succeeded. Data comes from the status files and the launchd job, read by the Host half.',
        levelOk: 'OK',
        levelWarn: 'Needs attention',
        levelBad: 'Problem',
        levelUnknown: 'Not configured',
        refresh: 'Refresh now',
        updatedAt: 'Updated',
        loading: 'Reading status…',
        unreachable: 'Status unavailable: the Host route did not respond.',
        notConfigured: 'No backup source is configured yet. Open Settings → Plugins and give dsh-dev-backup a status file path, or name a launchd job.',
        lastSuccess: 'Last success',
        age: 'Age',
        launchd: 'launchd job',
        launchdUnsupported: 'launchd is not available on this platform',
        failure: 'Last failure',
        command: 'Status command',
        exitCode: 'Exit code',
        never: 'never',
        hoursAgo: '{n} h ago',
        minutesAgo: '{n} min ago',
        justNow: 'just now',
        reasonStale: 'Last success was more than {n} hours ago',
        reasonMissing: 'Status file does not exist: {path}',
        reasonUnreadable: 'Status file is unreadable: {path}',
        reasonLaunchdNotLoaded: 'launchd job is not loaded: {label}',
        reasonLaunchdFailed: 'launchd last exit code was {code}',
        reasonFailureNewer: 'The most recent failure was not superseded by a later success',
        reasonCommandFailed: 'The status command exited with code {code}',
        reasonUnconfigured: 'No backup source is configured',
      },
    }

    function format(t, key, values) {
      let text = t(key)
      for (const [name, value] of Object.entries(values ?? {})) {
        text = text.split(`{${name}}`).join(String(value))
      }
      return text
    }

    function relative(t, ageHours) {
      if (ageHours === null || !Number.isFinite(ageHours)) return t('never')
      if (ageHours < 1 / 60) return t('justNow')
      if (ageHours < 1) return format(t, 'minutesAgo', { n: Math.max(1, Math.round(ageHours * 60)) })
      return format(t, 'hoursAgo', { n: Math.round(ageHours) })
    }

    function levelText(t, level) {
      if (level === 'ok') return t('levelOk')
      if (level === 'warn') return t('levelWarn')
      if (level === 'bad') return t('levelBad')
      return t('levelUnknown')
    }

    /** Turn a machine-readable reason into a sentence, so the panel explains itself. */
    function reasonText(t, reason) {
      switch (reason?.code) {
        case 'stale': return format(t, 'reasonStale', { n: Math.round(reason.staleAfterHours ?? 0) })
        case 'freshness-missing': return format(t, 'reasonMissing', { path: reason.path ?? '' })
        case 'freshness-unreadable': return format(t, 'reasonUnreadable', { path: reason.path ?? '' })
        case 'launchd-not-loaded': return format(t, 'reasonLaunchdNotLoaded', { label: reason.label ?? '' })
        case 'launchd-failed': return format(t, 'reasonLaunchdFailed', { code: reason.lastExitCode ?? '?' })
        case 'failure-not-superseded': return t('reasonFailureNewer')
        case 'command-failed': return format(t, 'reasonCommandFailed', { code: reason.exitCode ?? '?' })
        case 'unconfigured': return t('reasonUnconfigured')
        default: return null
      }
    }

    function stamp(value) {
      if (!Number.isFinite(value)) return '—'
      const date = new Date(value)
      const pad = n => String(n).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    function Row({ label, children }) {
      return jsxs('div', {
        className: 'dshBackupRow',
        children: [
          jsx('div', { className: 'dshBackupRowKey', children: label }),
          jsx('div', { className: 'dshBackupRowValue', children }),
        ],
      })
    }

    function DevBackupSection({ t }) {
      const [state, setState] = React.useState({ status: 'loading', data: null, error: null })
      const timer = React.useRef(null)

      const load = React.useCallback(async () => {
        try {
          const response = await fetch('/dsh-dev-backup/status', { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
          const data = await response.json()
          setState({ status: 'ready', data, error: null })
        } catch (error) {
          setState(previous => ({ status: 'error', data: previous.data, error: String(error?.message ?? error) }))
        }
      }, [])

      React.useEffect(() => {
        let cancelled = false
        const tick = () => { if (!cancelled) void load() }
        tick()
        const seconds = Number(state.data?.config?.refreshSeconds)
        const interval = Number.isFinite(seconds) && seconds >= 5 ? seconds : 30
        timer.current = setInterval(tick, interval * 1000)
        return () => {
          cancelled = true
          if (timer.current !== null) clearInterval(timer.current)
        }
      }, [load, state.data?.config?.refreshSeconds])

      const data = state.data
      const reasons = (data?.reasons ?? []).map(reason => reasonText(t, reason)).filter(Boolean)

      return jsxs('section', {
        className: 'dshBackupSection',
        children: [
          jsx('h2', { className: 'dshBackupHeading', children: t('title') }),
          jsx('p', { className: 'dshBackupIntro', children: t('intro') }),

          jsxs('div', {
            className: 'dshBackupCard',
            children: [
              jsx('span', { className: 'dshBackupDot', 'data-level': data?.level ?? 'unknown', 'aria-hidden': true }),
              jsxs('div', {
                className: 'dshBackupCopy',
                children: [
                  jsx('div', {
                    className: 'dshBackupLabel',
                    'aria-live': 'polite',
                    children: state.status === 'loading' ? t('loading') : levelText(t, data?.level),
                  }),
                  jsx('p', {
                    className: 'dshBackupMeta',
                    children: data
                      ? `${t('lastSuccess')}: ${stamp(data.freshness?.at)} · ${t('age')}: ${relative(t, data.ageHours)}`
                      : (state.status === 'error' ? t('unreachable') : t('loading')),
                  }),
                  reasons.length > 0
                    ? jsx('ul', {
                        className: 'dshBackupReasons',
                        children: reasons.map((text, index) => jsx('li', { children: text }, index)),
                      })
                    : null,
                ],
              }),
            ],
          }),

          // First run: the shipped default path does not exist yet, so a bare red "Problem" would
          // read as "this plugin is broken". Show the setup hint only when that is genuinely the
          // situation — untouched defaults AND the default file missing. Someone who simply uses
          // the convention without ever opening the settings form must NOT see it (their file is
          // there), and neither must someone who configured a path that later went missing (they
          // get the precise reason instead).
          data && (data.level === 'unknown'
            || (data.explicitlyConfigured === false && data.freshness?.missing === true))
            ? jsx('p', { className: 'dshBackupIntro', children: t('notConfigured') })
            : null,

          jsxs('div', {
            className: 'dshBackupRows',
            children: [
              jsx(Row, {
                label: t('launchd'),
                children: data?.launchd
                  ? jsx('span', {
                      className: 'dshBackupMono',
                      children: data.launchd.unsupported
                        ? t('launchdUnsupported')
                        : `${data.launchd.state ?? '—'} · ${t('exitCode')} ${data.launchd.lastExitCode ?? '—'}`,
                    })
                  : jsx('span', { className: 'dshBackupMeta', children: '—' }),
              }, 'launchd'),
              jsx(Row, {
                label: t('failure'),
                children: data?.failure
                  ? jsxs('span', {
                      className: 'dshBackupMono',
                      children: [stamp(data.failure.at), '  ', data.failure.message ?? ''],
                    })
                  : jsx('span', { className: 'dshBackupMeta', children: '—' }),
              }, 'failure'),
              jsx(Row, {
                label: t('command'),
                children: data?.command
                  ? jsxs('span', {
                      className: 'dshBackupMono',
                      children: [`${t('exitCode')} ${data.command.exitCode}\n`, data.command.output ?? ''],
                    })
                  : jsx('span', { className: 'dshBackupMeta', children: '—' }),
              }, 'command'),
            ],
          }),

          jsxs('div', {
            className: 'dshBackupActions',
            children: [
              jsx('button', {
                type: 'button',
                className: 'dshBackupButton',
                onClick: () => { void load() },
                children: t('refresh'),
              }),
              jsx('span', {
                className: 'dshBackupMeta',
                children: data ? `${t('updatedAt')} ${stamp(data.generatedAt)}` : '',
              }),
            ],
          }),
        ],
      })
    }

    // Profile entry id from this package's cordis.patch.yml.
    const ENTRY_ID = 'dsh-dev-backup'

    const inject = ['slots', 'locale']

    function apply(ctx) {
      const namespace = 'settings.dshDevBackup'
      const t = ctx.locale.bind(namespace)
      ctx.effect(
        () => ctx.locale.register(namespace, dictionaries),
        'dsh-dev-backup: panel dictionaries',
      )
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: ENTRY_ID,
        order: 45,
        label: () => t('nav'),
        locale: namespace,
        inject: () => ({}),
      }, DevBackupSection))
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
