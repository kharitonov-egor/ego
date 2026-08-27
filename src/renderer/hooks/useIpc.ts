export function windowMinimize(): void {
  window.api?.windowMinimize?.()
}

export function windowMaximize(): void {
  window.api?.windowMaximize?.()
}

export function windowClose(): void {
  window.api?.windowClose?.()
}
