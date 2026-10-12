'use strict';
(async () => {
 const $=id=>document.getElementById(id);
 const say=message=>{$('result').textContent=message;};
 const api=window.supabase?.createClient(
   'https://kfaolqnrqlypoyzkejlt.supabase.co',
   'sb_publishable_uT_FeTqwfX8AhkUtgmo--Q_bemTQkwP'
 );
 if(!api){$('accountStatus').textContent='No se pudo cargar el servicio de sesión.';say('Recarga la página para intentar nuevamente.');return;}
 let session=null;
 try {
   const res=await api.auth.getSession();
   session=res.data?.session||null;
 } catch {}
 if(!session){
   $('accountStatus').textContent='No hay una sesión iniciada en este navegador.';
   say('Inicia sesión con tu restaurante de prueba en Turnia y vuelve a abrir esta página.');
   return;
 }
 $('accountStatus').textContent='Sesión de Turnia detectada.';
 $('verify').disabled=false;
 say('Todo listo para comprobar la cuenta vendedora, sin realizar operaciones de pago.');
 $('verify').addEventListener('click',async()=>{
   $('verify').disabled=true;
   say('Consultando la cuenta de Mercado Pago de forma segura…');
   try {
     const {data,error}=await api.functions.invoke('turnia-sandbox-preflight',{body:{}});
     if(error){say('No se pudo completar la comprobación. Revisa la configuración de Supabase o vuelve a intentarlo.');return;}
     if(data?.ready===true && data?.seller_mode==='test'){
       say('Vendedor de prueba verificado. Los cobros y la activación automática continúan desactivados.');
     } else if(data?.reason==='Account not authorized for test preflight'){
       say('Esta cuenta no es la autorizada para realizar la prueba. Inicia sesión con el restaurante ficticio.');
     } else {
       say('La cuenta vendedora todavía no está validada como cuenta de prueba. No se ha realizado ningún cargo. Revisa la configuración de Mercado Pago antes de continuar.');
     }
   } catch {
     say('La comprobación no está disponible en este momento. No se ha iniciado ningún pago.');
   } finally{$('verify').disabled=false;}
 });
})();