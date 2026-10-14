export function publish(target: string): {
  latest: string;
  contract: string;
  files: Record<string, string>;
};
