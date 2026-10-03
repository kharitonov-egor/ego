import type { FoodAnalysis, FoodAnalysisMode, FoodProduct } from '@ego/core'

export interface FoodImage {
  base64: string
  mimeType: string
}

/** A meal photo, a fridge photo, or a description. The Worker asks the model and returns a draft. */
export interface FoodAnalyzeRequest {
  mode: FoodAnalysisMode
  image: FoodImage | null
  text: string
}

export type FoodAnalyzeResponse = FoodAnalysis

/** Null when neither USDA nor Open Food Facts knows the barcode. */
export interface FoodProductResponse {
  product: FoodProduct | null
}
