# Fonts

Putt Together uses two open-source typefaces, served from this folder so the app
doesn't depend on a third-party font service.

| File | Typeface | Used for | Licence |
| --- | --- | --- | --- |
| `Sora.woff` | Sora (variable weight, by Jonathan Barnbrook and others) | All text | SIL Open Font License 1.1 |
| `SpaceGrotesk.woff2` | Space Grotesk (variable weight, by Florian Karsten) | Headings, the wordmark | SIL Open Font License 1.1 |

The SIL Open Font License allows the fonts to be used, bundled and redistributed
freely with software, as long as they aren't sold on their own. The full licence
text is at https://openfontlicense.org.

Both are also available from Google Fonts. To swap to Google's copies, replace the
`@font-face` rules in `index.html` with a Google Fonts stylesheet link.
