import { runMoneyAgent, type MoneyAgentResult, type RunMoneyAgentInput } from '@ego/core'

export function askMoneyAgent(input: RunMoneyAgentInput): Promise<MoneyAgentResult> {
  return runMoneyAgent(input, fetch)
}
