/// <reference types="vite/client" />

declare module "*.css";

declare module "*?worker" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}
