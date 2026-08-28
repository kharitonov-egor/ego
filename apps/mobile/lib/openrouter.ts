import {
  analyzeTransactionImage,
  type AnalyzeTransactionImageInput,
  type TransactionImageAnalysisResult
} from '@ego/core'

export function analyzeImage(
  input: AnalyzeTransactionImageInput
): Promise<TransactionImageAnalysisResult> {
  return analyzeTransactionImage(input, fetch)
}
