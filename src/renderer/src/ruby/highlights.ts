/**
 * Ruby tree-sitter highlighting (spec 13 colors): query curated from
 * tree-sitter-ruby's highlights.scm, with capture names mapped to CSS
 * classes. Same approach as sourcedelve: tree-sitter drives highlighting,
 * ruby-lsp semantic tokens stay disabled.
 */

export const RUBY_HIGHLIGHTS_QUERY = String.raw`
[
  "alias" "and" "begin" "break" "case" "class" "def" "do" "else" "elsif"
  "end" "ensure" "for" "if" "in" "module" "next" "or" "rescue" "retry"
  "return" "then" "unless" "until" "when" "while" "yield"
] @keyword

((identifier) @keyword.special
 (#match? @keyword.special "^(require|require_relative|include|extend|prepend|attr_reader|attr_writer|attr_accessor|raise|throw|catch|module_function|private|public|protected)$"))

(comment) @comment

(string) @string
(heredoc_body) @string
(heredoc_beginning) @string
(escape_sequence) @string.escape
(regex) @string.special
(subshell) @string.special

(simple_symbol) @symbol
(delimited_symbol) @symbol
(hash_key_symbol) @symbol
(bare_symbol) @symbol

(integer) @number
(float) @number
(complex) @number
(rational) @number

[(nil) (true) (false)] @constant.builtin
(self) @variable.builtin
(super) @variable.builtin

(instance_variable) @property
(class_variable) @property
(global_variable) @property

(constant) @type

(class name: (constant) @type.definition)
(module name: (constant) @type.definition)
(method name: [(identifier) (constant)] @function)
(singleton_method name: [(identifier) (constant)] @function)

(call method: (identifier) @function.call)

(interpolation "#{" @punctuation.special "}" @punctuation.special)
`

/** capture name → CSS class (colors defined in main.css from spec 13 tokens) */
export const CAPTURE_CLASSES: Record<string, string> = {
  keyword: 'tsh-keyword',
  'keyword.special': 'tsh-keyword',
  comment: 'tsh-comment',
  string: 'tsh-string',
  'string.escape': 'tsh-escape',
  'string.special': 'tsh-regex',
  symbol: 'tsh-symbol',
  number: 'tsh-number',
  'constant.builtin': 'tsh-number',
  'variable.builtin': 'tsh-keyword',
  property: 'tsh-property',
  type: 'tsh-type',
  'type.definition': 'tsh-type',
  function: 'tsh-function',
  'function.call': 'tsh-function',
  'punctuation.special': 'tsh-escape'
}
