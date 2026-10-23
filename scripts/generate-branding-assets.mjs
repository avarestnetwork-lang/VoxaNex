import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

async function generateBrandingAssets() {
  const srcPath = path.resolve('public/assets/aistudio/Glossy_Magenta_Chat_Bubble_Monogram_708919db.png');
  
  if (!fs.existsSync(srcPath)) {
    throw new Error(`Source asset not found at ${srcPath}`);
  }

  console.log('Loading source image...');
  const img = sharp(srcPath);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });

  // 1. Cleanse stray alpha and artifacts
  const cleaned = Buffer.from(data);
  let minX = info.width, maxX = 0, minY = info.height, maxY = 0;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const idx = (y * info.width + x) * 4;
      const a = cleaned[idx + 3];

      // Filter out stray ghost pixels: alpha <= 6 or outside emblem bounding region
      if (a <= 6 || x < 100 || x > 1220 || y < 105 || y > 1145) {
        cleaned[idx] = 0;
        cleaned[idx + 1] = 0;
        cleaned[idx + 2] = 0;
        cleaned[idx + 3] = 0;
      } else {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  console.log(`Extracted emblem bounding box: [${minX}, ${minY}, ${cropWidth}x${cropHeight}]`);

  // Extract the cropped emblem buffer
  const croppedEmblemBuffer = await sharp(cleaned, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .extract({
      left: minX,
      top: minY,
      width: cropWidth,
      height: cropHeight,
    })
    .png()
    .toBuffer();

  // 2. Create master 1024x1024 centered logo with elegant transparent padding (~7% on each side)
  const masterSize = 1024;
  const targetEmblemDim = 880; // leaves 72px padding on all sides for max visual impact
  const scale = targetEmblemDim / Math.max(cropWidth, cropHeight);
  const scaledWidth = Math.round(cropWidth * scale);
  const scaledHeight = Math.round(cropHeight * scale);

  const scaledEmblem = await sharp(croppedEmblemBuffer)
    .resize(scaledWidth, scaledHeight, {
      fit: 'inside',
      kernel: sharp.kernel.lanczos3,
    })
    .toBuffer();

  const leftPad = Math.round((masterSize - scaledWidth) / 2);
  const topPad = Math.round((masterSize - scaledHeight) / 2);

  const masterLogo = await sharp({
    create: {
      width: masterSize,
      height: masterSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }, // 100% genuine alpha channel
    },
  })
    .composite([
      {
        input: scaledEmblem,
        left: leftPad,
        top: topPad,
      },
    ])
    .png()
    .toBuffer();

  // Ensure public/assets directory exists
  if (!fs.existsSync('public/assets')) {
    fs.mkdirSync('public/assets', { recursive: true });
  }

  // Save master transparent logo in public directories
  fs.writeFileSync('public/logo.png', masterLogo);
  fs.writeFileSync('public/assets/logo.png', masterLogo);
  console.log('Saved public/logo.png and public/assets/logo.png (1024x1024 transparent)');

  // 3. Generate Apple Touch Icon (180x180)
  const appleTouchSize = 180;
  const appleScaled = await sharp(masterLogo)
    .resize(appleTouchSize, appleTouchSize, {
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toFile('public/apple-touch-icon.png');
  console.log('Saved public/apple-touch-icon.png (180x180)');

  // 4. Generate Standard Favicons: 32x32 and 16x16 PNGs
  await sharp(masterLogo)
    .resize(32, 32, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toFile('public/favicon-32x32.png');
  console.log('Saved public/favicon-32x32.png');

  await sharp(masterLogo)
    .resize(16, 16, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toFile('public/favicon-16x16.png');
  console.log('Saved public/favicon-16x16.png');

  // Also create a 48x48 for ICO multi-resolution
  await sharp(masterLogo)
    .resize(48, 48, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toFile('public/favicon-48x48.png');

  // 5. Generate Multi-Size favicon.ico using ImageMagick
  try {
    execSync('convert public/favicon-16x16.png public/favicon-32x32.png public/favicon-48x48.png -colors 256 public/favicon.ico');
    console.log('Generated multi-size public/favicon.ico');
    // Remove temporary 48x48
    fs.unlinkSync('public/favicon-48x48.png');
  } catch (err) {
    console.error('ImageMagick favicon.ico conversion failed, using sharp 32x32 fallback:', err);
    fs.copyFileSync('public/favicon-32x32.png', 'public/favicon.ico');
  }

  // 6. Generate Android / PWA Icons
  // PWA 192x192
  await sharp(masterLogo)
    .resize(192, 192, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toFile('public/pwa-192x192.png');
  console.log('Saved public/pwa-192x192.png');

  // PWA 512x512
  await sharp(masterLogo)
    .resize(512, 512, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toFile('public/pwa-512x512.png');
  console.log('Saved public/pwa-512x512.png');

  // PWA Maskable 512x512 (Safe-zone padded with app brand dark background #090d18)
  const maskableEmblemDim = 380; // ~74% diameter fits comfortably inside 80% safe zone circle
  const maskableScale = maskableEmblemDim / Math.max(cropWidth, cropHeight);
  const mWidth = Math.round(cropWidth * maskableScale);
  const mHeight = Math.round(cropHeight * maskableScale);

  const scaledMaskableEmblem = await sharp(croppedEmblemBuffer)
    .resize(mWidth, mHeight, { kernel: sharp.kernel.lanczos3 })
    .toBuffer();

  const mLeft = Math.round((512 - mWidth) / 2);
  const mTop = Math.round((512 - mHeight) / 2);

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 9, g: 13, b: 24, alpha: 1 }, // #090d18 brand dark theme background
    },
  })
    .composite([
      {
        input: scaledMaskableEmblem,
        left: mLeft,
        top: mTop,
      },
    ])
    .png()
    .toFile('public/pwa-maskable-512x512.png');
  console.log('Saved public/pwa-maskable-512x512.png');

  console.log('All branding assets generated successfully!');
}

generateBrandingAssets().catch(err => {
  console.error('Error generating assets:', err);
  process.exit(1);
});
