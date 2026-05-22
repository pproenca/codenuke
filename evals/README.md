# codenuke Loop Evals

`pnpm eval` runs a deterministic smoke of the published loop CLI against a temporary
git repository. It exercises the readiness path, fence artifact generation, calibration
artifact generation, and final `doctor` readiness check without touching the user tree.
