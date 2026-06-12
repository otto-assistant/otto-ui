declare module 'react-syntax-highlighter/create-element' {
  import type { ReactNode } from 'react';

  type CreateElementOptions = {
    node: unknown;
    stylesheet: unknown;
    useInlineStyles: boolean;
    key?: string | number;
  };

  const createElement: (options: CreateElementOptions) => ReactNode;

  export default createElement;
}

// The on-demand Prism build (see components/chat/syntaxHighlighterAsync.ts).
// @types/react-syntax-highlighter ships an ambient declaration for this deep
// path, but it isn't picked up under our module resolution because the real
// .js resolves first with no co-located types, so declare it locally.
declare module 'react-syntax-highlighter/dist/esm/prism-async-light' {
  import type { Component } from 'react';
  import type { SyntaxHighlighterProps } from 'react-syntax-highlighter';

  export default class SyntaxHighlighter extends Component<SyntaxHighlighterProps> {
    static registerLanguage(name: string, func: unknown): void;
  }
}
