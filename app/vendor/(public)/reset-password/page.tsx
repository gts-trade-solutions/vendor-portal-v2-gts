// In app/your-route/page.tsx or layout.tsx
export const dynamic = 'force-dynamic';

import React from 'react'
import VendorResetPasswordPage from './ResetPassword';

const page = () => {
  return (
    <VendorResetPasswordPage/>
  )
}

export default page