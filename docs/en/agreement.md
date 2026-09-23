<!-- agreement-version: 3 -->

# SPlayer Next User Agreement and Disclaimer

**Version: v1.2**  
**Effective: May 29, 2026**  
**Last updated: August 12, 2026**

This English translation is provided for convenience. If it differs from the [Chinese agreement](/agreement), the Chinese text prevails.

SPlayer Next is a free and open-source cross-platform desktop music player. Read this agreement, especially limitations of liability, governing law, and dispute provisions, before downloading or using it. If you do not agree, stop using and delete the software. Minors should review it with a guardian.

## 1. Definitions

- **Developer:** The copyright holders and open-source contributors, including the `SPlayer-Dev` GitHub organization and project author.
- **User / you:** Any individual or organization that installs or uses the software.
- **Local content:** Audio stored on your devices or storage you are authorized to access.
- **Online platform:** A public online music service operated independently by a third party.
- **Self-hosted media server:** A Subsonic-compatible, Jellyfin, Emby, or similar server you operate or are authorized to access.
- **Third-party plugin / source:** A community script imported locally or from the network, including compatible LX Music scripts.

## 2. Nature of the software

The software is a client-side tool for decoding, playing, organizing, and managing local audio and, when configured by you, interacting with online platforms, self-hosted servers, or plugins.

It is free software provided without a promise of commercial service, continued maintenance, or support for a particular purpose. Rights to use, copy, modify, and redistribute it are governed by AGPL-3.0.

The software itself does not provide, host, or distribute audio content and does not include online accounts, third-party sources, or copyrighted catalogs. Content and metadata come from your local files, configured services, or plugins, and no warranty is made about them.

## 3. AGPL-3.0 license

SPlayer Next is licensed under the GNU Affero General Public License v3.0. The complete license is in `LICENSE`.

When copying, modifying, or redistributing the software, comply with AGPL-3.0, including preserving notices, providing corresponding source where required, identifying modifications, and not imposing incompatible additional restrictions. If a modified version is offered for remote network interaction, AGPL-3.0 section 13 may require offering its complete corresponding source to those users.

The official source repository is <https://github.com/SPlayer-Dev/SPlayer-Next>. This agreement explains functionality, third-party risks, trademarks, and applicable law; it does not reduce rights granted by AGPL-3.0. If a conflict exists, AGPL-3.0 prevails.

## 4. Scope and acceptable use

You may use, copy, modify, and redistribute the software under AGPL-3.0, including for personal, research, or commercial purposes.

You must not use the software to violate applicable law, infringe third-party rights, bypass access controls or technical protections, misrepresent official affiliation or endorsement through names or visual assets, scrape or resell protected content unlawfully, or operate an unauthorized public content service.

## 5. Online and third-party features

### 5.1 Online platforms

The software provides general client capabilities that request data when initiated by you. Third-party platforms are independently operated and are not affiliated with or authorized by the developers. Their terms, privacy policies, copyright rules, access controls, and availability apply.

### 5.2 Self-hosted servers

You must be authorized to access each configured server and its content. You are responsible for server availability, legality, and security.

### 5.3 Plugins and sources

The software includes an open extension mechanism and optional plugin market. Market entries index third-party submissions; they are not authored or operated by the SPlayer Next developers unless explicitly stated.

Market submissions receive automated checks and maintainer review, but this is not a complete security audit, legal determination, or endorsement. Locally or remotely imported plugins do not pass through market review. Plugins are executable code that can make network requests and persist data, so inspect their source and permissions and install only trusted plugins.

### 5.4 Copyrighted data

The developers claim no ownership over track URLs, metadata, lyrics, covers, or other third-party content. Your access, storage, use, and distribution must comply with applicable law, authorization from rights holders, and platform terms. Technical capability does not grant rights to third-party content.

### 5.5 MCP and external APIs

HTTP, WebSocket, and MCP interfaces are neutral local control mechanisms. You are responsible for actions, data changes, and security risks caused by AI agents, automation scripts, or other clients using them.

## 6. Accounts and credentials

Credentials are used only for requested features and remain on your device. Streaming passwords and Last.fm session keys prefer operating-system `safeStorage`; when unavailable, the app stores them as Base64 and logs a warning. AI model API keys are not saved without secure storage. Base64 is not encryption. The developers do not upload these credentials to a server they control.

You are responsible for protecting accounts, devices, and credentials.

## 7. Intellectual property and trademarks

Copyright in the software remains with its contributors subject to AGPL-3.0. Rights in the “SPlayer” and “SPlayer Next” names, logos, and visual identity are reserved. Do not use them in a way that creates confusion, false affiliation, or endorsement. Rights in third-party content remain with their respective owners.

## 8. User responsibility

Use the software lawfully and only with content you own, are authorized to access, or may use under applicable law. The software does not monitor or approve user actions. You are responsible for infringement, unlawful distribution, platform-term violations, and resulting claims or penalties.

## 9. Privacy and local data

The software does not include developer-controlled telemetry or usage analytics and does not upload personally identifiable information to the developers. Configuration, library indexes, queues, history, favorites, covers, caches, and logs are stored locally. Network features communicate directly with the configured third party and are subject to that party's privacy policy. See the [Privacy Policy](/en/privacy).

## 10. Distribution channels and security

Official version information and original packages are published through <https://github.com/SPlayer-Dev/SPlayer-Next>; <https://splayer-next.imsyy.top> provides documentation and download entry points.

The website may offer third-party acceleration routes that proxy official GitHub assets, so requests pass through those services. Other mirrors, app stores, repackaged builds, and redistributions are not controlled or verified by the developers and are not official releases. They may be modified, outdated, bundled, or malicious.

## 11. Updates

The application may optionally check and download releases from the official repository. No particular release is guaranteed continued maintenance, and development or distribution may change or stop.

## 12. Third-party open-source components

Electron, Vue, FFmpeg, rodio, and other dependencies retain their own copyrights and licenses. Their applicable notices and terms are listed in the source and dependency records.

## 13. Disclaimer

The software is provided **“AS IS” and “AS AVAILABLE”**, without express or implied warranties, including merchantability, fitness for a particular purpose, non-infringement, uninterrupted availability, security, compatibility, or data integrity, to the maximum extent permitted by law.

The developers are not responsible for data loss, device failures, interruption, security incidents, third-party service changes, plugin behavior, or unlawful use, except where liability cannot legally be excluded.

## 14. Limitation of liability

To the maximum extent permitted by law, the developers are not liable for indirect, incidental, special, punitive, or consequential damages. Total liability is limited to the amount you actually paid the developers for the software, if any; the software is normally provided without charge. Mandatory local law may override some limitations.

## 15. Minors

The software is not specifically designed for persons without legal capacity. Minors should use it with guardian consent and supervision.

## 16. Changes

This agreement may be revised for legal or functional changes and published with a release or through official channels. If you do not accept a revision, stop using the software.

## 17. Governing law and disputes

This agreement is governed by the laws of mainland China, excluding conflict-of-law rules, while mandatory laws in your jurisdiction still apply. The parties should first attempt good-faith negotiation; unresolved disputes may be brought before a court with jurisdiction.

## 18. General terms

If a provision is invalid or unenforceable, the remaining provisions continue to apply. This agreement, the Privacy Policy, AGPL-3.0, and third-party licenses form the relevant terms. Failure to enforce a right is not a waiver. No agency, partnership, employment, joint venture, or endorsement relationship is created.

## 19. Contact

- [GitHub repository](https://github.com/SPlayer-Dev/SPlayer-Next)
- [Issue tracker](https://github.com/SPlayer-Dev/SPlayer-Next/issues)
- [Official website](https://splayer-next.imsyy.top)
- Email: imsyy1024@gmail.com
