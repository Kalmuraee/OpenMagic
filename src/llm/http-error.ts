/**
 * Maps an HTTP error from an LLM provider to a user-facing message.
 *
 * 429 responses are ambiguous: they cover both transient rate limiting
 * (retry helps) and hard quota/billing exhaustion (retry never helps).
 * The provider's JSON error body distinguishes them — check it before
 * telling the user to wait.
 */
export function describeProviderHttpError(
  status: number,
  providerName: string,
  errorText: string,
): string {
  if (status === 401 || status === 403) {
    return `Invalid API key for ${providerName}. Check your key in Settings.`;
  }
  if (status === 429) {
    const lower = errorText.toLowerCase();
    if (
      lower.includes("insufficient_quota") ||
      lower.includes("credit_balance") ||
      lower.includes("billing") ||
      lower.includes("no credits") ||
      lower.includes("exceeded your current quota")
    ) {
      return `${providerName} reports the account is out of credits or quota. Add credit on the provider's billing page, or switch to a different provider in Settings — retrying will not help.`;
    }
    return `Rate limit exceeded for ${providerName}. Wait a moment and try again.`;
  }
  return `${providerName} API error ${status}: ${errorText.slice(0, 200)}`;
}
