import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./media.css";
import "./metadata.css";

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Uncaught application error", error, info.componentStack);
  }

  render() {
    if (this.state.error) return <div className="boot-screen" role="alert"><img src="/logo.svg" alt=""/><h1>界面发生错误</h1><p>{this.state.error}</p><button onClick={() => window.location.reload()}>重新加载</button></div>;
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </StrictMode>,
);
