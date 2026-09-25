import { useCallback, useEffect, useRef, useState } from "react";
import { appPreferenceStorage } from "../../../platform/tauri/app-storage.js";
import { notifyActionError } from "../../notifications/action-notifications.js";
import {
  applyCustomBackgroundMutation,
  createCustomBackgroundImage,
  publishWorkbenchBackgroundPreference,
  readCustomBackgroundImages,
  readWorkbenchBackgroundPreference,
  removeCustomBackgroundFromDraft,
  type CustomBackgroundImage,
  type WorkbenchBackgroundPreference,
} from "../workbench-background-preference.js";

export function useWorkbenchBackgroundDraft() {
  const [background, updateBackground] = useState(() => readWorkbenchBackgroundPreference(appPreferenceStorage));
  const backgroundRef = useRef(background);
  const [customImages, setCustomImages] = useState<readonly CustomBackgroundImage[]>([]);
  const imagesRef = useRef(customImages);
  const [isLoading, setLoading] = useState(true);
  const [isSavingImages, setSavingImages] = useState(false);
  const savingRef = useRef(false);
  const [loadError, setLoadError] = useState(false);
  const [loadVersion, reload] = useState(0);

  useEffect(() => {
    // 无背景和 Bing 模式不读取自定义图库，切换模式时取消过期加载结果。
    if (background.mode !== "custom") {
      setLoading(false);
      return;
    }
    let disposed = false;
    setLoading(true);
    setLoadError(false);
    void readCustomBackgroundImages().then((images) => {
      if (disposed) return;
      imagesRef.current = images;
      setCustomImages(images);
    }).catch(() => {
      if (!disposed) setLoadError(true);
    }).finally(() => {
      if (!disposed) setLoading(false);
    });
    return () => { disposed = true; };
  }, [background.mode, loadVersion]);

  const setBackground = useCallback((next: WorkbenchBackgroundPreference) => {
    backgroundRef.current = next;
    updateBackground(next);
    // 纯偏好同步发布，由 Rust 存储 actor 合并落盘；滑块不等待 IPC，也不会被保存状态禁用。
    publishWorkbenchBackgroundPreference(next);
  }, []);

  const storeImages = (images: readonly CustomBackgroundImage[]) => {
    imagesRef.current = images;
    setCustomImages(images);
  };

  return {
    background,
    customImages,
    isLoading,
    isSavingImages,
    loadError,
    retryLoad: () => reload((version) => version + 1),
    setBackground,
    addCustomBackgroundFiles: (files: readonly File[]) => {
      if (savingRef.current || isLoading || loadError || files.length === 0) return;
      savingRef.current = true;
      setSavingImages(true);
      const added = files.map((file) => createCustomBackgroundImage(file));
      void applyCustomBackgroundMutation({ imagesToSave: added, deletedImageIds: [] })
        .then(async () => {
          storeImages([...imagesRef.current, ...added]);
          setBackground({ ...backgroundRef.current, mode: "custom", selectedCustomImageId: added[0]!.id });
          // 已落盘的文件切换为 asset URL，释放导入时保留的 Blob。
          await readCustomBackgroundImages().then(storeImages).catch(() => undefined);
        })
        .catch(notifyActionError)
        .finally(() => { savingRef.current = false; setSavingImages(false); });
    },
    removeCustomBackgroundImage: (imageId: string) => {
      if (savingRef.current || isLoading || loadError) return;
      savingRef.current = true;
      setSavingImages(true);
      void applyCustomBackgroundMutation({ imagesToSave: [], deletedImageIds: [imageId] })
        .then(() => {
          const current = backgroundRef.current;
          const next = removeCustomBackgroundFromDraft(imagesRef.current, imageId, current.selectedCustomImageId);
          storeImages(next.images);
          // 删除最后一张图时退出自定义模式，避免空选择阻止删除落盘。
          setBackground({ ...current, selectedCustomImageId: next.selectedCustomImageId,
            mode: current.mode === "custom" && next.selectedCustomImageId === null ? "none" : current.mode });
        })
        .catch(notifyActionError)
        .finally(() => { savingRef.current = false; setSavingImages(false); });
    },
    selectCustomBackgroundImage: (imageId: string) => {
      if (imagesRef.current.some((image) => image.id === imageId)) {
        setBackground({ ...backgroundRef.current, mode: "custom", selectedCustomImageId: imageId });
      }
    },
  } as const;
}
