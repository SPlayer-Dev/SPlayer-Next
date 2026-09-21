/**
 * TTML 解析与生成相关的 XML 命名空间与常量定义
 */

export const NS = {
  TT: "http://www.w3.org/ns/ttml",
  TTM: "http://www.w3.org/ns/ttml#metadata",
  ITUNES: "http://music.apple.com/lyric-ttml-internal",
  AMLL: "http://www.example.com/ns/amll",
  TTS: "http://www.w3.org/ns/ttml#styling",
} as const;

export const Elements = {
  TT: "tt",
  Head: "head",
  Body: "body",
  Div: "div",
  P: "p",
  Span: "span",
  Title: "title",
  Name: "name",
  Meta: "meta",
  ITunesMetadata: "iTunesMetadata",
  TTMLMetadata: "metadata",
  Songwriters: "songwriters",
  Songwriter: "songwriter",
  Translation: "translation",
  Translations: "translations",
  Transliteration: "transliteration",
  Transliterations: "transliterations",
  Text: "text",
  Agent: "agent",
} as const;

export const Attributes = {
  Timing: "timing",
  Id: "id",
  Key: "key",
  Value: "value",
  Lang: "lang",
  For: "for",
  SongPart: "songPart",
  Begin: "begin",
  End: "end",
  Role: "role",
  Type: "type",
  Dur: "dur",
  Ruby: "ruby",
  Obscene: "obscene",
  EmptyBeat: "empty-beat",
} as const;

export const Values = {
  Word: "Word",
  Line: "Line",
  MimeXML: "application/xml",
  MusicName: "musicName",
  Artists: "artists",
  Album: "album",
  ISRC: "isrc",
  TTMLAuthorGithub: "ttmlAuthorGithub",
  TTMLAuthorGithubLogin: "ttmlAuthorGithubLogin",
  NCMMusicId: "ncmMusicId",
  QQMusicId: "qqMusicId",
  SpotifyId: "spotifyId",
  AppleMusicId: "appleMusicId",
  RoleBg: "x-bg",
  RoleTranslation: "x-translation",
  RoleRoman: "x-roman",
  Group: "group",
  Person: "person",
  Other: "other",
  AgentDefault: "v1",
  AgentDefaultDuet: "v2",
  RubyContainer: "container",
  RubyBase: "base",
  RubyTextContainer: "textContainer",
  RubyText: "text",
} as const;
