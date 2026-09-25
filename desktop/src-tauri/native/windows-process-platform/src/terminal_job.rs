use windows::{
    Win32::{
        Foundation::{CloseHandle, HANDLE},
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
                SetInformationJobObject, TerminateJobObject,
            },
            Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
        },
    },
    core::PCWSTR,
};

/// 独占 Job 句柄，关闭 Job 时回收所有未显式脱离的受管后代。
pub struct TerminalJob(isize);

impl TerminalJob {
    pub fn assign(pid: u32) -> windows::core::Result<Self> {
        // SAFETY: 创建无名称、不可继承的 Job，所有指针仅在同步调用期间有效。
        let handle = unsafe { CreateJobObjectW(None, PCWSTR::null())? };
        let job = Self(handle.0 as isize);
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            )?;
            let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid)?;
            let result = AssignProcessToJobObject(handle, process);
            let _ = CloseHandle(process);
            result?;
        }
        Ok(job)
    }

    pub fn terminate(&self) -> windows::core::Result<()> {
        // SAFETY: 句柄由当前对象独占，在 Drop 前持续有效。
        unsafe { TerminateJobObject(HANDLE(self.0 as *mut _), 1) }
    }
}

impl Drop for TerminalJob {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(HANDLE(self.0 as *mut _));
        }
    }
}
