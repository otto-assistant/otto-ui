// Shared syntax highlighter for chat/code surfaces.
//
// We import the `prism-async-light` build directly (NOT the package root) on
// purpose. The default `Prism` export eagerly pulls in `refractor`, which
// registers ~200 language grammars at import time. In dev that fans out into
// 1000+ module requests the moment any markdown/code renders, and in prod it
// bloats the syntax chunk. Importing from the package root barrel would drag
// the full build into the bundle even if we only referenced PrismAsyncLight,
// so we reference the deep entry point instead.
//
// `prism-async-light` loads `refractor/core` plus only the language grammars
// actually used by rendered code blocks, on demand. API is identical to the
// `Prism` component (same `language`/`style`/`customStyle`/`PreTag`/… props),
// so this is a drop-in replacement.
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-async-light';

export default SyntaxHighlighter;
