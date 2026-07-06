#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Simple build script for CineBuddy extension
console.log('🎬 Building CineBuddy Extension...');

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

// Simple minification for JS files
function minifyJS(content) {
    // Check if we're in development mode
    if (process.env.NODE_ENV === 'development') {
        return content; // Keep original formatting for easier debugging
    }
    
    return content
        .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
        .replace(/\/\/.*$/gm, '') // Remove line comments
        .replace(/\s+/g, ' ') // Collapse whitespace
        .replace(/\s*([{}();,=])\s*/g, '$1') // Remove spaces around operators
        .trim();
}

// Simple minification for CSS files
function minifyCSS(content) {
    // Check if we're in development mode
    if (process.env.NODE_ENV === 'development') {
        return content; // Keep original formatting for easier debugging
    }
    
    return content
        .replace(/\/\*[\s\S]*?\*\//g, '') // Remove comments
        .replace(/\s+/g, ' ') // Collapse whitespace
        .replace(/\s*([{}:;,>+~])\s*/g, '$1') // Remove spaces around selectors
        .trim();
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
