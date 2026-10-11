import type { FoodAnalysis, FoodAnalysisMode, FoodNutrients, FoodNutrientsQuery, FoodProduct } from '@ego/core'

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

/** A meal logged before saturated fat, fiber, and sodium were tracked, with its photo when it has one. */
export interface FoodNutrientsRequest extends FoodNutrientsQuery {
  image: FoodImage | null
}

/** One set per part, in the request's order. */
export interface FoodNutrientsResponse {
  parts: FoodNutrients[]
}
