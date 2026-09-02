import type { ApiError } from "@finance-demo/contracts";

export const UNKNOWN_TICKER_ERROR: ApiError = {
  error: {
    code: "UNKNOWN_TICKER",
    message: "Unknown ticker symbol.",
    detail: "ZZZZ is not present in the SEC company ticker directory.",
  },
};

export const BAD_REQUEST_ERROR: ApiError = {
  error: {
    code: "BAD_REQUEST",
    message: "Invalid request body.",
    detail: "question: Too small: expected string to have >=3 characters",
  },
};

/** `detail` is explicitly nullable in the contract. */
export const INTERNAL_ERROR: ApiError = {
  error: { code: "INTERNAL", message: "Something went wrong.", detail: null },
};
