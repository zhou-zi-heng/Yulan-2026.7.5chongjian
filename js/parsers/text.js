const TEXT_EXTS = new Set([
    // 通用文本
    'txt', 'md', 'markdown', 'mdx', 'rst', 'log', 'text', 'readme',
    // 数据/配置
    'json', 'jsonc', 'json5', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg',
    'env', 'properties', 'plist', 'csv', 'tsv', 'tab',
    // Web 前端
    'html', 'htm', 'xhtml', 'shtml', 'css', 'scss', 'sass', 'less', 'styl',
    'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx',
    'vue', 'svelte', 'astro', 'pug', 'jade', 'ejs', 'hbs', 'handlebars',
    // 后端语言
    'py', 'pyw', 'pyi', 'rb', 'rbw', 'php', 'phtml',
    'go', 'rs', 'java', 'kt', 'kts', 'scala', 'groovy',
    'swift', 'm', 'mm',
    'c', 'cpp', 'cc', 'cxx', 'c++', 'h', 'hpp', 'hxx', 'hh',
    'cs', 'fs', 'fsx', 'vb',
    'r', 'rmd', 'jl', 'lua', 'pl', 'pm', 'dart',
    'erl', 'ex', 'exs', 'elm', 'clj', 'cljs', 'edn',
    'hs', 'lhs', 'ml', 'mli', 'nim', 'cr', 'zig',
    // Shell / DevOps
    'sh', 'bash', 'zsh', 'fish', 'ksh',
    'bat', 'cmd', 'ps1', 'psm1', 'psd1',
    'dockerfile', 'containerfile', 'makefile', 'mk',
    'gradle', 'sbt', 'cmake',
    // 数据库 / 查询
    'sql', 'graphql', 'gql', 'cypher', 'sparql',
    'proto', 'thrift', 'avsc', 'avdl',
    // 移动端
    'gradle', 'pbxproj', 'xcconfig',
    // 其他
    'tex', 'bib', 'sty', 'cls',
    'diff', 'patch',
    'srt', 'vtt', 'sub', 'sbv',
    'asm', 's',
    'gitignore', 'gitattributes', 'editorconfig',
    'eslintrc', 'prettierrc', 'babelrc', 'browserslistrc',
    'npmrc', 'yarnrc',
    'lock', 'sum', 'mod',  // package-lock, go.sum, go.mod
]);
