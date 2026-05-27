export const SOURCE_RAW_HARD_CAP_BYTES = 32_768;
// Soft cap is one quarter of the hard cap. Tying them together keeps the
// "you're at 25% of the budget" warning useful regardless of how the hard
// cap is tuned downstream.
export const SOURCE_RAW_SOFT_CAP_BYTES = SOURCE_RAW_HARD_CAP_BYTES / 4;
