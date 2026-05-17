export type ComposerKeyInput = {
  ctrlKey: boolean;
  isComposing: boolean;
  key: string;
  metaKey: boolean;
};

export type ComposerKeyIntent = "ignore" | "newline" | "send";

export function composerKeyIntent(input: ComposerKeyInput): ComposerKeyIntent {
  if (input.isComposing || input.key !== "Enter") {
    return "ignore";
  }
  if (input.ctrlKey || input.metaKey) {
    return "newline";
  }
  return "send";
}
