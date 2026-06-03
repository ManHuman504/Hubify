#[cfg(target_os = "windows")]
pub fn extract_icon(exe_path: &str) -> Option<String> {
    use windows::Win32::UI::Shell::{
        SHGetFileInfoW, SHGetImageList, SHFILEINFOW, SHGFI_SYSICONINDEX,
        SHIL_JUMBO,
    };
    use windows::Win32::UI::Controls::IImageList;
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits,
        BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, SelectObject,
    };
    use windows::core::Interface;
    use base64::Engine;

    unsafe {
        // Step 1: get system icon index
        let wide: Vec<u16> = exe_path.encode_utf16().chain(std::iter::once(0)).collect();
        let mut shfi = SHFILEINFOW::default();
        let ok = SHGetFileInfoW(
            windows::core::PCWSTR(wide.as_ptr()),
            Default::default(),
            Some(&mut shfi),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_SYSICONINDEX,
        );
        if ok == 0 { return None; }
        let idx = shfi.iIcon;

        // Step 2: get jumbo (256x256) image list
        let iml: IImageList = SHGetImageList(SHIL_JUMBO as i32).ok()?;
        let hicon = iml.GetIcon(idx, 0x00000001).ok()?; // ILD_TRANSPARENT

        let mut icon_info = ICONINFO::default();
        if GetIconInfo(hicon, &mut icon_info).is_err() {
            let _ = DestroyIcon(hicon);
            return None;
        }

        let hdc = CreateCompatibleDC(None);
        let size = 256i32;
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: size,
                biHeight: -size,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0,
                biSizeImage: (size * size * 4) as u32,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut pixels = vec![0u8; (size * size * 4) as usize];
        let old = SelectObject(hdc, icon_info.hbmColor);
        GetDIBits(hdc, icon_info.hbmColor, 0, size as u32,
            Some(pixels.as_mut_ptr() as *mut _), &mut bmi, DIB_RGB_COLORS);
        SelectObject(hdc, old);

        // BGRA → RGBA
        for chunk in pixels.chunks_exact_mut(4) {
            chunk.swap(0, 2);
        }

        let _ = DeleteDC(hdc);
        let _ = DeleteObject(icon_info.hbmColor);
        let _ = DeleteObject(icon_info.hbmMask);
        let _ = DestroyIcon(hicon);

        let img = image::RgbaImage::from_raw(size as u32, size as u32, pixels)?;
        let mut buf = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png).ok()?;
        Some(format!("data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&buf)))
    }
}

#[cfg(not(target_os = "windows"))]
pub fn extract_icon(_exe_path: &str) -> Option<String> { None }
