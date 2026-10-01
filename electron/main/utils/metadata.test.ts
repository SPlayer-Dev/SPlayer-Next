import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseGenres, formatGenres } from "./metadata";

describe("parseGenres", () => {
  it("把无空格的斜杠视为流派名称的一部分", () => {
    assert.deepEqual(parseGenres("Singer/Songwriter"), ["Singer/Songwriter"]);
    assert.deepEqual(parseGenres("R&B/Soul"), ["R&B/Soul"]);
  });

  it("空格不是分隔符", () => {
    assert.deepEqual(parseGenres("Pop Rock"), ["Pop Rock"]);
  });

  it("把无空格的 & 视为流派名称的一部分", () => {
    assert.deepEqual(parseGenres("R&B"), ["R&B"]);
    assert.deepEqual(parseGenres("R & B"), ["R & B"]);
  });

  it("按逗号、分号、斜杠与 & 拆分多个流派", () => {
    assert.deepEqual(parseGenres("Pop, Rock"), ["Pop", "Rock"]);
    assert.deepEqual(parseGenres("Pop & Rock"), ["Pop", "Rock"]);
    assert.deepEqual(parseGenres("Pop; Rock"), ["Pop", "Rock"]);
    assert.deepEqual(parseGenres("Pop // Rock"), ["Pop", "Rock"]);
    assert.deepEqual(parseGenres("Pop / Rock"), ["Pop", "Rock"]);
    assert.deepEqual(parseGenres("Pop//Rock"), ["Pop", "Rock"]);
  });

  it("保护已知的复合流派", () => {
    assert.deepEqual(parseGenres("Rock & Roll, Pop"), ["Rock & Roll", "Pop"]);
    assert.deepEqual(parseGenres("R&B/Soul; Hip Hop/Rap"), ["R&B/Soul", "Hip Hop/Rap"]);
    assert.deepEqual(parseGenres("Singer / Songwriter & Folk"), ["Singer / Songwriter", "Folk"]);
  });

  it("清理空白、引号与 ID3v1 数字流派", () => {
    assert.deepEqual(parseGenres('  "Pop"  ,  Rock '), ["Pop", "Rock"]);
    assert.deepEqual(parseGenres("(17)Rock"), ["Rock"]);
    assert.deepEqual(parseGenres("(17)"), []);
    assert.deepEqual(parseGenres("Unknown"), []);
  });

  it("忽略大小写去重并保留首次出现的写法", () => {
    assert.deepEqual(parseGenres("Pop, POP, pop"), ["Pop"]);
  });

  it("空值返回空数组", () => {
    assert.deepEqual(parseGenres(""), []);
    assert.deepEqual(parseGenres(undefined), []);
  });
});

describe("formatGenres", () => {
  it("按分隔符拼接流派", () => {
    assert.equal(formatGenres(["Pop", "Rock"]), "Pop / Rock");
    assert.equal(formatGenres([]), "");
    assert.equal(formatGenres(undefined), "");
  });
});
