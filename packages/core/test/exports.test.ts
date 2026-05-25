import { describe, expect, it } from "@effect/vitest";
import { publicExportSurface } from "../src/index.ts";

describe("publicExportSurface", () => {
  it("tracks type-only named exports", () => {
    expect(publicExportSurface("export type { A }\nexport { type B }\n")).toEqual(["type:A", "type:B"]);
  });

  it("keeps value exports named type distinct from inline type modifiers", () => {
    expect(publicExportSurface("const type = 1\nexport { type as value }\n")).toEqual(["value:value"]);
  });

  it("tracks class exports in both namespaces", () => {
    expect(publicExportSurface("export class Foo {}\n")).toEqual(["type:Foo", "value:Foo"]);
  });

  it("preserves class surface through local named exports", () => {
    expect(publicExportSurface("class Foo {}\nexport { Foo }\n")).toEqual(["type:Foo", "value:Foo"]);
  });

  it("merges same-name local type and value surfaces", () => {
    expect(publicExportSurface("type Foo = number\nconst Foo = 1\nexport { Foo }\n")).toEqual([
      "type:Foo",
      "value:Foo",
    ]);
  });

  it("tracks default exports through local identifiers", () => {
    expect(publicExportSurface("class Foo {}\nexport default Foo\n")).toEqual(["type:default", "value:default"]);
  });

  it("classifies re-export clauses without local shadows", () => {
    expect(publicExportSurface("type Foo = number\nexport { Foo } from './mod'\n")).toEqual([
      "type:Foo",
      "value:Foo",
    ]);
  });

  it("tracks exported namespace members", () => {
    expect(publicExportSurface("export namespace API { export const value = 1; export interface Data {} }\n")).toEqual([
      "type:API",
      "type:API.Data",
      "value:API",
      "value:API.value",
    ]);
  });

  it("tracks local namespace members exposed through named exports", () => {
    expect(publicExportSurface("namespace API { export const value = 1 }\nexport { API }\n")).toEqual([
      "type:API",
      "value:API",
      "value:API.value",
    ]);
  });

  it("tracks local namespace members exposed through default exports", () => {
    expect(publicExportSurface("namespace API { export const value = 1 }\nexport default API\n")).toEqual([
      "type:default",
      "value:default",
      "value:default.value",
    ]);
  });

  it("tracks merged namespace members exposed through named exports", () => {
    expect(
      publicExportSurface(
        "namespace API { export const value = 1 }\nnamespace API { export interface Data {} }\nexport { API }\n",
      ),
    ).toEqual([
      "type:API",
      "type:API.Data",
      "value:API",
      "value:API.value",
    ]);
  });

  it("tracks ambient module exports", () => {
    expect(publicExportSurface('declare module "pkg" { export const value: string; export interface Data {} }\n')).toEqual([
      "type:module:pkg.Data",
      "value:module:pkg.value",
    ]);
  });

  it("tracks implicit ambient module declarations", () => {
    expect(publicExportSurface('declare module "pkg" { interface Data {} const value: string }\n')).toEqual([
      "type:module:pkg.Data",
      "value:module:pkg.value",
    ]);
  });

  it("tracks ambient global exports", () => {
    expect(publicExportSurface("declare global { export interface Window { value: string } }\n")).toEqual([
      "type:global.Window",
    ]);
  });

  it("tracks type-only namespace member exports", () => {
    expect(publicExportSurface("namespace API { export interface Data {}; export const value = 1 }\nexport type { API }\n")).toEqual([
      "type:API",
      "type:API.Data",
    ]);
  });

  it("tracks top-level ambient declarations in declaration files", () => {
    expect(publicExportSurface("interface Window { value: string }\ndeclare const Foo: string\n", "ambient.d.ts")).toEqual([
      "type:Window",
      "value:Foo",
    ]);
  });

  it("tracks top-level ambient namespace members in declaration files", () => {
    expect(publicExportSurface("declare namespace API { interface Data {} const value: string }\n", "ambient.d.ts")).toEqual([
      "type:API",
      "type:API.Data",
      "value:API",
      "value:API.value",
    ]);
  });

  it("tracks dotted ambient namespace members in declaration files", () => {
    expect(publicExportSurface("declare namespace React.JSX { interface IntrinsicElements {} }\n", "ambient.d.ts")).toEqual([
      "type:React",
      "type:React.JSX.IntrinsicElements",
      "value:React",
    ]);
  });

  it("tracks export assignment type and namespace surfaces", () => {
    expect(
      publicExportSurface("declare class Foo {}\ndeclare namespace Foo { interface Data {} }\nexport = Foo\n", "module.d.ts"),
    ).toEqual([
      "type:export=",
      "type:export=.Data",
      "value:export=",
    ]);
  });

  it("does not treat private declarations in external declaration files as public", () => {
    expect(publicExportSurface("export {}\ninterface Private {}\n", "module.d.ts")).toEqual([]);
  });

  it("tracks implicit members in exported declaration-file namespaces", () => {
    expect(publicExportSurface("export {}\nexport namespace API { interface Data {} const value: string }\n", "module.d.ts")).toEqual([
      "type:API",
      "type:API.Data",
      "value:API",
      "value:API.value",
    ]);
  });
});
