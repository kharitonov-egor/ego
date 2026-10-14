declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native'
  const source: ImageSourcePropType
  export default source
}

declare module '*.wav' {
  const asset: number
  export default asset
}
