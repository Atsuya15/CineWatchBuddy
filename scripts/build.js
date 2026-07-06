#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Simple build script for CineWatchBuddy extension
console.log('🎬 Building CineWatchBuddy Extension...');

// Validate manifest.json
function validateManifest() {
    const manifestPath = path.join(__dirname, '..', 'src', 'extension', 'manifest.json');
    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        
        // Check required fields
        const required = ['manifest_version', 'name', 'version', 'permissions'];
        for (const field of required) {
            if (!manifest[field]) {
                throw new Error(`Missing required field: ${field}`);
            }
        }
        
        // Check manifest version
        if (manifest.manifest_version !== 3) {
            console.warn('⚠️  Manifest version is not 3, some features may not work');
        }
        
        console.log('✅ Manifest validation passed');
        return true;
    } catch (error) {
        console.error('❌ Manifest validation failed:', error.message);
        return false;
    }
}

const distDir = path.join(__dirname, '..', 'dist');
const extensionDir = path.join(__dirname, '..', 'src', 'extension');

// Create dist directory if it doesn't exist
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

// NOTE: The previous regex "minifier" stripped `//` line comments in a way that
// also destroyed `//` inside string literals such as `ws://localhost:8080` — which
// corrupted the built scripts. For an unpacked dev extension the size win isn't
// worth that risk, so we copy JS/CSS verbatim.
function minifyJS(content) {
    return content;
}

function minifyCSS(content) {
    return content;
}

// Copy extension files to dist
function copyDirectory(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const files = fs.readdirSync(src);
    
    files.forEach(file => {
        const srcPath = path.join(src, file);
        const destPath = path.join(dest, file);
        
        if (fs.statSync(srcPath).isDirectory()) {
            // Skip node_modules and other unnecessary directories
            if (file === 'node_modules' || file === '.git') {
                return;
            }
            copyDirectory(srcPath, destPath);
        } else {
            // Minify JS and CSS files
            if (file.endsWith('.js')) {
                const content = fs.readFileSync(srcPath, 'utf8');
                const minified = minifyJS(content);
                fs.writeFileSync(destPath, minified);
            } else if (file.endsWith('.css')) {
                const content = fs.readFileSync(srcPath, 'utf8');
                const minified = minifyCSS(content);
                fs.writeFileSync(destPath, minified);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    });
}

// Validate manifest first
if (!validateManifest()) {
    process.exit(1);
}

// Copy all extension files
copyDirectory(extensionDir, distDir);

// Create a simple build info file
const buildInfo = {
    buildTime: new Date().toISOString(),
    version: '1.0.0',
    buildType: 'development'
};

fs.writeFileSync(
    path.join(distDir, 'build-info.json'),
    JSON.stringify(buildInfo, null, 2)
);

console.log('✅ Extension built successfully!');
console.log(`📁 Output directory: ${distDir}`);
console.log('🚀 Ready to load in browser');
