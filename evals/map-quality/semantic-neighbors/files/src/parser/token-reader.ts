export function readParserToken(streamValue: string): string[] {
  return streamValue.split(/\s+/u).filter((token) => token.length > 0);
}
