declare module "*.svg" {
  const path: `${string}.svg`;
  export = path;
}

declare module "*.css" {}

declare module "*.html" {
  const value: import("bun").HTMLBundle;
  export default value;
}
