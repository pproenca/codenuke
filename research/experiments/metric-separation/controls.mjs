// Synthetic TS/React control set for the metric separation check (METRIC.md §5).
//
// Each control is a transition before -> after with a behavior probe.
// Expected verdicts:
//   positive       : all gates pass, large positive gain
//   positive-react : all gates pass, positive gain
//   N1 (reformat)  : gain ~ 0 (P1 formatting invariance)
//   N2 (break)     : REJECTED by G1 behavior gate, even though it reduces code (P3)
//   N3 (churn)     : gain <= 0, not rewarded (P5 granularity defense)

// ---- shared duplicated policy (the "tax") ----
const MAPPING = `  if (name.startsWith("opus")) return 1;
  if (name.startsWith("mp4a")) return 2;
  if (name.startsWith("mp3")) return 3;
  if (name.startsWith("flac")) return 4;
  if (name.startsWith("vorbis")) return 5;
  return 0;`;

const dupLeaf = (fn) => `export function ${fn}(name: string): number {
${MAPPING}
}
`;

const thinLeaf = (fn) => `import { codecId } from "./codec";
export const ${fn} = (name: string): number => codecId(name);
`;

const indexReExports = `export { audioId } from "./audio";
export { videoId } from "./video";
export { imageId } from "./image";
export { dataId } from "./data";
`;

const codecHelper = (mapping = MAPPING) => `export function codecId(name: string): number {
${mapping}
}
`;

const codecProbe = [
  { fn: "audioId", args: ["opus"] },
  { fn: "videoId", args: ["mp4a.40.2"] },
  { fn: "imageId", args: ["mp3"] },
  { fn: "dataId", args: ["flac"] },
  { fn: "audioId", args: ["vorbis"] },
  { fn: "videoId", args: ["unknown-codec"] },
];

const positiveBefore = {
  "audio.ts": dupLeaf("audioId"),
  "video.ts": dupLeaf("videoId"),
  "image.ts": dupLeaf("imageId"),
  "data.ts": dupLeaf("dataId"),
  "index.ts": indexReExports,
};

const positiveAfter = {
  "codec.ts": codecHelper(),
  "audio.ts": thinLeaf("audioId"),
  "video.ts": thinLeaf("videoId"),
  "image.ts": thinLeaf("imageId"),
  "data.ts": thinLeaf("dataId"),
  "index.ts": indexReExports,
};

// N2: same DRY collapse as positive, but also silently drops the flac branch.
// Reduces code AND looks like a great refactor, but changes behavior on "flac".
const breakMapping = `  if (name.startsWith("opus")) return 1;
  if (name.startsWith("mp4a")) return 2;
  if (name.startsWith("mp3")) return 3;
  if (name.startsWith("vorbis")) return 5;
  return 0;`;

// ---- React control (presentational badge duplicated across cards) ----
const cardBefore = (comp, field) => `export function ${comp}(props: { ${field}: string; status: string }) {
  return (
    <div className="card">
      <div className="badge-wrap">
        <span className={"badge badge-" + props.status} title={"status: " + props.status}>
          <i className={"icon icon-" + props.status} />
          <em>{props.status.toUpperCase()}</em>
        </span>
      </div>
      <b>{props.${field}}</b>
    </div>
  );
}
`;

const cardAfter = (comp, field) => `import { Badge } from "./Badge";
export function ${comp}(props: { ${field}: string; status: string }) {
  return (
    <div className="card">
      <Badge status={props.status} />
      <b>{props.${field}}</b>
    </div>
  );
}
`;

const badgeComponent = `export function Badge(props: { status: string }) {
  return (
    <div className="badge-wrap">
      <span className={"badge badge-" + props.status} title={"status: " + props.status}>
        <i className={"icon icon-" + props.status} />
        <em>{props.status.toUpperCase()}</em>
      </span>
    </div>
  );
}
`;

const reactIndex = `export { UserCard } from "./UserCard";
export { OrderCard } from "./OrderCard";
export { ItemCard } from "./ItemCard";
`;

const reactProbe = [
  { fn: "UserCard", args: [{ name: "Ada", status: "ok" }] },
  { fn: "OrderCard", args: [{ ref: "X-1", status: "pending" }] },
  { fn: "ItemCard", args: [{ sku: "SKU9", status: "error" }] },
];

const reactBefore = {
  "UserCard.tsx": cardBefore("UserCard", "name"),
  "OrderCard.tsx": cardBefore("OrderCard", "ref"),
  "ItemCard.tsx": cardBefore("ItemCard", "sku"),
  "index.tsx": reactIndex,
};

const reactAfter = {
  "Badge.tsx": badgeComponent,
  "UserCard.tsx": cardAfter("UserCard", "name"),
  "OrderCard.tsx": cardAfter("OrderCard", "ref"),
  "ItemCard.tsx": cardAfter("ItemCard", "sku"),
  "index.tsx": reactIndex,
};

// ---- N1 / N3 operate on a single cohesive function ----
const calcCohesive = `export function score(a: number, b: number): number {
  const base = a * 2 + b;
  const adjusted = base > 10 ? base - 1 : base + 1;
  return adjusted * 3;
}
`;

// N1: whitespace + local rename only (no structural change).
const calcReformatted = `export function score(a: number, b: number): number {
  const   b0      = a * 2 + b;
  const   adj     = b0 > 10
        ? b0 - 1
        : b0 + 1;
  return adj * 3;
}
`;

// N3: split one cohesive function into five trivial helpers (extract-method churn).
const calcChurned = `function dbl(a: number): number { return a * 2; }
function addB(x: number, b: number): number { return x + b; }
function adjust(x: number): number { return x > 10 ? x - 1 : x + 1; }
function triple(x: number): number { return x * 3; }
export function score(a: number, b: number): number {
  return triple(adjust(addB(dbl(a), b)));
}
`;

const calcProbe = [
  { fn: "score", args: [3, 4] },
  { fn: "score", args: [6, 1] },
  { fn: "score", args: [0, 0] },
];

export const controls = [
  {
    name: "positive (codec policy DRY)",
    kind: "positive",
    entry: "index.ts",
    region: ["audio.ts", "video.ts", "image.ts", "data.ts"],
    probe: codecProbe,
    before: positiveBefore,
    after: positiveAfter,
  },
  {
    name: "positive-react (badge component)",
    kind: "positive",
    entry: "index.tsx",
    region: ["UserCard.tsx", "OrderCard.tsx", "ItemCard.tsx"],
    probe: reactProbe,
    before: reactBefore,
    after: reactAfter,
  },
  {
    name: "N1 reformat (cosmetic only)",
    kind: "N1",
    entry: "calc.ts",
    region: ["calc.ts"],
    probe: calcProbe,
    before: { "calc.ts": calcCohesive },
    after: { "calc.ts": calcReformatted },
  },
  {
    name: "N2 behavior-break (DRY but drops flac)",
    kind: "N2",
    entry: "index.ts",
    region: ["audio.ts", "video.ts", "image.ts", "data.ts"],
    probe: codecProbe,
    before: positiveBefore,
    after: {
      "codec.ts": codecHelper(breakMapping),
      "audio.ts": thinLeaf("audioId"),
      "video.ts": thinLeaf("videoId"),
      "image.ts": thinLeaf("imageId"),
      "data.ts": thinLeaf("dataId"),
      "index.ts": indexReExports,
    },
  },
  {
    name: "N3 churn (extract-method splitting)",
    kind: "N3",
    entry: "calc.ts",
    region: ["calc.ts"],
    probe: calcProbe,
    before: { "calc.ts": calcCohesive },
    after: { "calc.ts": calcChurned },
  },
];
