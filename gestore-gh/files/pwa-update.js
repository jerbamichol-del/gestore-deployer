(function(){
  if(!('serviceWorker' in navigator)) return;
  var scopeGuess = '/gestore/';
  var FLAG = 'pwa-skip-waiting';
  var PERIOD_MS = 15 * 60 * 1000;
  var FIRST_START_DELAY = 2000;
  var VERSION_URL = scopeGuess + 'version.json?ts=' + Date.now();
  var LAST_KEY = 'pwa-last-commit';
  function banner(onAccept,onDismiss){
    if (document.getElementById('pwa-update-banner')) return;
    var w=document.createElement('div');
    w.id='pwa-update-banner';
    w.className='fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] w-[92%] max-w-md rounded-xl border bg-white shadow-xl p-4 flex items-start gap-3';
    w.innerHTML='<div class="flex-1"><h3 class="font-semibold">Aggiornamento disponibile</h3><p class="text-sm mt-1">È pronta una nuova versione dell\'app.</p></div><div class="flex gap-2"><button id="pwa-update-later" class="px-3 py-2 text-sm rounded-lg bg-slate-200">Più tardi</button><button id="pwa-update-now" class="px-3 py-2 text-sm rounded-lg bg-indigo-600 text-white">Aggiorna</button></div>';
    document.body.appendChild(w);
    document.getElementById('pwa-update-later').onclick=function(){ w.remove(); onDismiss&&onDismiss(); };
    document.getElementById('pwa-update-now').onclick=function(){ w.remove(); try { sessionStorage.setItem(FLAG,'1'); } catch(e){} onAccept&&onAccept(); };
  }
  navigator.serviceWorker.addEventListener('controllerchange', function(){
    try { if (sessionStorage.getItem(FLAG) === '1') { sessionStorage.removeItem(FLAG); location.reload(); } } catch(e){}
  });
  function wire(reg){
    function showIfWaiting(){
      if(reg.waiting && navigator.serviceWorker.controller){
        banner(function(){ reg.waiting && reg.waiting.postMessage({type:'SKIP_WAITING'}); }, function(){});
      }
    }
    showIfWaiting();
    reg.addEventListener('updatefound', function(){
      var nw = reg.installing;
      nw && nw.addEventListener('statechange', function(){
        if(nw.state==='installed' && navigator.serviceWorker.controller){ showIfWaiting(); }
      });
    });
    function checkVersion(){
      fetch(VERSION_URL, { cache: 'no-store' })
        .then(r=>r.json())
        .then(v=>{
          var last = ''; try { last = localStorage.getItem(LAST_KEY)||''; } catch(e){}
          var cur = (v && v.commit) || '';
          if (cur && cur !== last) {
            if (!reg.waiting) {
              banner(function(){
                try { localStorage.setItem(LAST_KEY, String(cur)); } catch(e){}
                location.reload();
              }, function(){});
            }
          }
        }).catch(function(){});
    }
    var check = function(){ reg.update().catch(function(){}); checkVersion(); };
    setTimeout(check, FIRST_START_DELAY);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'visible') check(); });
    setInterval(check, PERIOD_MS);
  }
  window.addEventListener('load', function(){
    (navigator.serviceWorker.getRegistration(scopeGuess).catch(function(){}) )
      .then(function(reg){ return reg || navigator.serviceWorker.getRegistration(); })
      .then(function(reg){ reg && wire(reg); })
      .catch(function(){});
  });
})();