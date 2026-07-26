import fs from 'fs';
import path from 'path';

const srcDir = path.join(process.cwd(), 'src');
const stylesPath = path.join(srcDir, 'styles.css');

const files = fs.readdirSync(srcDir)
  .filter(f => f.endsWith('.ts'))
  .map(f => path.join(srcDir, f));

let cssContent = '\n/* --- AUTO-EXTRACTED INLINE STYLES --- */\n';
let styleMap = new Map();
let classCounter = 1;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf-8');
  let originalContent = content;

  // Regex to match style="something" (simplistic but handles most cases)
  const styleRegex = /style="([^"]+)"/g;
  
  content = content.replace(styleRegex, (match, styleString) => {
    // If the style string contains template variables ${}, we CANNOT extract it statically
    if (styleString.includes('${')) {
      return match;
    }

    const trimmedStyle = styleString.trim();
    if (!trimmedStyle) return match;

    let className;
    if (styleMap.has(trimmedStyle)) {
      className = styleMap.get(trimmedStyle);
    } else {
      className = `agy-style-${classCounter++}`;
      styleMap.set(trimmedStyle, className);
      cssContent += `.${className} { ${trimmedStyle} }\n`;
    }

    // Return just the class injection for now. 
    // We will append it to the HTML element.
    // To avoid invalid HTML like class="a" class="b", we should ideally merge classes.
    // For this fast refactor, we inject a special custom attribute that we can parse later, 
    // or just inject class="agy-style-X" and hope the browser tolerates it (browsers usually take the first, so it might break if there's an existing class).
    // Better: We inject `class="${className}"` if no class exists, but it's hard via simple regex.
    // We will do a generic replacement: replace `style="X"` with `class="${className}"`.
    // If an element has two class attributes, the first is used. We will rely on a secondary regex to merge them.
    return `class="${className}"`;
  });

  // Secondary pass: merge adjacent class attributes: class="a" class="b" -> class="a b"
  const mergeClassRegex = /class="([^"]+)"\s+class="([^"]+)"/g;
  // Run multiple times in case there are 3 classes
  for(let i=0; i<3; i++) {
    content = content.replace(mergeClassRegex, 'class="$1 $2"');
  }

  if (content !== originalContent) {
    fs.writeFileSync(file, content, 'utf-8');
    console.log(`Updated ${path.basename(file)}`);
  }
});

fs.appendFileSync(stylesPath, cssContent);
console.log(`Extracted ${styleMap.size} unique inline styles to styles.css`);
