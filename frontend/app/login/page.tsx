'use client';
import { useState } from 'react';
export default function Login(){
  const [msg,setMsg]=useState('');
  async function onSubmit(e:any){e.preventDefault(); const f=new FormData(e.target); const r=await fetch('http://localhost:4000/api/auth/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:f.get('username'),password:f.get('password')})}); setMsg(r.ok?'تم الدخول':'فشل الدخول');}
  return <form onSubmit={onSubmit}><h2>تسجيل الدخول</h2><input name='username' placeholder='اسم المستخدم'/><input name='password' placeholder='كلمة المرور' type='password'/><button>دخول</button><p>{msg}</p></form>
}
