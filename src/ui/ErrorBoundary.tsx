import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  /** 出错时用来描述"哪一块"，例如「本周记录」 */
  label?: string
  /** 自定义兜底内容；不传就用默认的小卡片 */
  fallback?: (reset: () => void) => ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * 区块级兜底：某一块渲染崩了只坏这一块，不牵连整个应用。
 * React 18 里未捕获的渲染错误会卸载整棵树（白屏），所以需要它来兜住。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[随记] ${this.props.label ?? '未知区块'} 渲染出错：`, error, info.componentStack)
  }

  private reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.fallback) return this.props.fallback(this.reset)

    return (
      <div className="error-fallback" role="alert">
        <p className="error-fallback-title">{this.props.label ?? '这一块'}没能显示出来</p>
        <p className="error-fallback-text">其它功能不受影响，可以重试这一块。</p>
        <button type="button" className="error-fallback-btn" onClick={this.reset}>
          重试
        </button>
      </div>
    )
  }
}
