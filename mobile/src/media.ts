import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 60;

export async function pickMedia(kind: 'images' | 'videos'): Promise<ImagePicker.ImagePickerAsset | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('اسمح للتطبيق بالوصول إلى مكتبة الصور لاختيار ملف.');

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: [kind],
    quality: 0.82,
    videoMaxDuration: MAX_VIDEO_SECONDS,
    ...(Platform.OS === 'ios' ? {
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
    } : {}),
  });
  if (result.canceled || !result.assets?.length) return null;

  let asset: ImagePicker.ImagePickerAsset = {
    ...result.assets[0],
    type: kind === 'videos' ? 'video' : 'image',
  };
  if (kind === 'images') asset = await prepareImage(asset);
  if (kind === 'videos') asset = await prepareVideo(asset);

  const limit = kind === 'videos' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (asset.fileSize !== undefined && asset.fileSize > limit) {
    throw new Error(kind === 'videos'
      ? 'حجم الفيديو أكبر من 20MB. اختر مقطعًا أقصر أو أصغر.'
      : 'حجم الصورة أكبر من 5MB. اختر صورة أصغر.');
  }
  return asset;
}

async function prepareImage(asset: ImagePicker.ImagePickerAsset): Promise<ImagePicker.ImagePickerAsset> {
  const mime = (asset.mimeType || '').toLowerCase().split(';')[0];
  const extension = asset.fileName?.split('.').pop()?.toLowerCase() || '';
  const needsJpeg = mime === 'image/heic' || mime === 'image/heif' || extension === 'heic' || extension === 'heif' || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime);
  const tooLargeForServer = (asset.fileSize || 0) > MAX_IMAGE_BYTES;
  const needsResize = asset.width > 2048 || asset.height > 2048;
  if (!needsJpeg && !tooLargeForServer && !needsResize) {
    return { ...asset, mimeType: mime, type: 'image' };
  }

  const resizeAction = needsResize
    ? [{ resize: asset.width >= asset.height ? { width: 2048 } : { height: 2048 } }]
    : [];
  let converted: ImageManipulator.ImageResult;
  try {
    converted = await ImageManipulator.manipulateAsync(asset.uri, resizeAction, {
      compress: 0.78,
      format: ImageManipulator.SaveFormat.JPEG,
    });
  } catch {
    throw new Error('تعذر تجهيز الصورة بصيغة JPEG. اختر صورة أخرى بصيغة JPG أو PNG.');
  }
  const info = await FileSystem.getInfoAsync(converted.uri);
  const size = info.exists ? info.size : undefined;
  if (size !== undefined && size > MAX_IMAGE_BYTES) {
    throw new Error('الصورة أكبر من 5MB حتى بعد ضغطها. اختر صورة أصغر.');
  }
  return {
    ...asset,
    uri: converted.uri,
    fileName: `ytrana-photo-${Date.now()}.jpg`,
    mimeType: 'image/jpeg',
    fileSize: size ?? asset.fileSize,
    width: converted.width,
    height: converted.height,
    type: 'image',
  };
}

async function prepareVideo(asset: ImagePicker.ImagePickerAsset): Promise<ImagePicker.ImagePickerAsset> {
  const extension = asset.fileName?.split('.').pop()?.toLowerCase() || '';
  const mime = (asset.mimeType || '').toLowerCase().split(';')[0];
  const compatibleMime = mime === 'video/mp4' || mime === 'video/quicktime' || mime === 'video/webm'
    ? mime
    : extension === 'mov' ? 'video/quicktime' : extension === 'webm' ? 'video/webm' : 'video/mp4';
  let size = asset.fileSize;
  if (size === undefined) {
    try {
      const info = await FileSystem.getInfoAsync(asset.uri);
      if (info.exists) size = info.size;
    } catch {
      // The upload helper performs a second availability check and gives a clear error if needed.
    }
  }
  if (asset.duration && asset.duration > (MAX_VIDEO_SECONDS * 1000) + 500) {
    throw new Error('مدة الفيديو أطول من 60 ثانية. اختر مقطعًا أقصر.');
  }
  return { ...asset, mimeType: compatibleMime, fileSize: size, type: 'video' };
}
