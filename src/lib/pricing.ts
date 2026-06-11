export const PRICING = {
  sonnet: {
    inputPerMillion: 3,
    outputPerMillion: 15,
  },
  haiku: {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
  },
  blendedPerMillion: 4,
} as const

export const TOKENS_PER_MILLION = 1_000_000

export function estimateBlendedCost(tokens: number): number {
  return (tokens / TOKENS_PER_MILLION) * PRICING.blendedPerMillion
}

export function estimateSonnetCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / TOKENS_PER_MILLION) * PRICING.sonnet.inputPerMillion +
    (outputTokens / TOKENS_PER_MILLION) * PRICING.sonnet.outputPerMillion
  )
}

export function estimateHaikuCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / TOKENS_PER_MILLION) * PRICING.haiku.inputPerMillion +
    (outputTokens / TOKENS_PER_MILLION) * PRICING.haiku.outputPerMillion
  )
}
