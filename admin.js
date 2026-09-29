// admin.js — lógica do painel administrativo da DROP VENDAS.

(function(){
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function money(n){ return 'R$ ' + Number(n || 0).toFixed(2).replace('.', ','); }
  function showToast(msg, isError){
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.style.background = isError ? '#ff5c5c' : '#3ddc84';
    t.style.color = isError ? '#fff' : '#04101c';
    t.style.display = 'block';
    setTimeout(function(){ t.style.display = 'none'; }, 3000);
  }
  function api(url, opts){
    opts = opts || {};
    opts.headers = opts.headers || {};
    if (opts.body && !(opts.body instanceof FormData)){
      opts.headers['Content-Type'] = 'application/json';
    }
    return fetch(url, opts).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(d){
        if (!r.ok) throw new Error(d.error || 'Erro na requisição.');
        return d;
      });
    });
  }

  // ---- Guarda de autenticação: sem sessão válida, manda pro login ----
  api('/api/admin/me').then(function(d){
    if (!d.authenticated){ window.location.href = '/login'; return; }
    initApp();
  }).catch(function(){ window.location.href = '/login'; });

  function initApp(){
    // ---- Navegação entre abas ----
    document.querySelectorAll('.menu button[data-tab]').forEach(function(btn){
      btn.addEventListener('click', function(){ openTab(btn.getAttribute('data-tab')); });
    });
    document.querySelectorAll('[data-goto]').forEach(function(btn){
      btn.addEventListener('click', function(){ openTab(btn.getAttribute('data-goto')); });
    });
    function openTab(id){
      document.querySelectorAll('.section').forEach(function(s){ s.classList.remove('active'); });
      document.getElementById(id).classList.add('active');
      document.querySelectorAll('.menu button[data-tab]').forEach(function(b){ b.classList.remove('on'); });
      var target = document.querySelector('.menu button[data-tab="' + id + '"]');
      if (target) target.classList.add('on');
      if (id === 'dash') loadDashboard();
      if (id === 'orders') loadOrders();
      if (id === 'products') loadProducts();
      if (id === 'clients') loadCustomers();
      if (id === 'config') loadSettings();
    }

    document.getElementById('logoutBtn').addEventListener('click', function(){
      api('/api/logout', { method: 'POST' }).finally(function(){ window.location.href = '/login'; });
    });

    // ================= Dashboard =================
    function loadDashboard(){
      api('/api/admin/summary').then(function(d){
        document.getElementById('kpiOrdersToday').textContent = d.ordersToday;
        document.getElementById('kpiPending').textContent = d.pending;
        document.getElementById('kpiSalesToday').textContent = money(d.salesToday);
        document.getElementById('kpiClients').textContent = d.clients;
      }).catch(function(e){ showToast(e.message, true); });

      api('/api/admin/orders').then(function(rows){
        var tbody = document.querySelector('#recentOrdersTable tbody');
        tbody.innerHTML = rows.slice(0, 6).map(function(o){
          return '<tr><td>#' + o.id + '</td><td>' + esc(o.product_name) + '</td><td>' + esc(o.price) + '</td>' +
            '<td><span class="tag">' + esc(o.status) + '</span></td></tr>';
        }).join('') || '<tr><td colspan="4" class="muted">Nenhum pedido ainda.</td></tr>';
      });
    }
    document.getElementById('refreshDash').addEventListener('click', loadDashboard);

    // ================= Pedidos =================
    var STATUS_OPTIONS = ['Aguardando entrega', 'Enviado', 'Entregue'];
    function statusOptionsHtml(current){
      return STATUS_OPTIONS.map(function(s){ return '<option value="' + s + '"' + (s === current ? ' selected' : '') + '>' + s + '</option>'; }).join('');
    }
    function copyText(text){
      navigator.clipboard.writeText(text).then(function(){ showToast('Copiado!'); }).catch(function(){ showToast('Não foi possível copiar.', true); });
    }

    function loadOrders(){
      api('/api/admin/orders').then(function(rows){
        var tbody = document.querySelector('#ordersTable tbody');
        tbody.innerHTML = rows.map(function(o){
          var idsHtml = '<div style="display:grid; gap:6px;">' +
            '<div><b>ID 1:</b> ' + esc(o.ff_id) + ' <button class="btn btn-sm btn-ghost copy-id" data-copy="' + esc(o.ff_id) + '">📋</button>' +
            '<select data-order="' + o.id + '" data-part="1">' + statusOptionsHtml(o.status1) + '</select></div>' +
            (o.ff_id2 ? '<div><b>ID 2:</b> ' + esc(o.ff_id2) + ' <button class="btn btn-sm btn-ghost copy-id" data-copy="' + esc(o.ff_id2) + '">📋</button>' +
              '<select data-order="' + o.id + '" data-part="2">' + statusOptionsHtml(o.status2) + '</select></div>' : '') +
            '</div>';
          return '<tr>' +
            '<td>#' + o.id + '</td>' +
            '<td>' + esc(o.product_name) + '</td>' +
            '<td>' + esc(o.price) + '</td>' +
            '<td>' + idsHtml + '</td>' +
            '<td>' + esc(o.customer_whatsapp || '—') + '</td>' +
            '<td>' + esc((o.created_at || '').replace('T', ' ').slice(0, 16)) + '</td>' +
            '<td><b>' + esc(o.status) + '</b></td>' +
            '<td><button class="btn btn-sm btn-ghost copy-track" data-track="' + esc(o.tracking_token) + '">🔗 Copiar link</button></td>' +
            '</tr>';
        }).join('') || '<tr><td colspan="8" class="muted">Nenhum pedido ainda.</td></tr>';

        tbody.querySelectorAll('.copy-id').forEach(function(b){ b.addEventListener('click', function(){ copyText(b.getAttribute('data-copy')); }); });
        tbody.querySelectorAll('.copy-track').forEach(function(b){
          b.addEventListener('click', function(){ copyText(location.origin + '/pedido/' + b.getAttribute('data-track')); });
        });
        tbody.querySelectorAll('select[data-order]').forEach(function(sel){
          sel.addEventListener('change', function(){
            var body = {};
            body['status' + sel.getAttribute('data-part')] = sel.value;
            api('/api/admin/orders/' + sel.getAttribute('data-order'), { method: 'PATCH', body: JSON.stringify(body) })
              .then(function(){ showToast('Status atualizado!'); loadOrders(); })
              .catch(function(e){ showToast(e.message, true); });
          });
        });
      }).catch(function(e){ showToast(e.message, true); });

      loadPassReservations();
    }
    document.getElementById('refreshOrders').addEventListener('click', loadOrders);

    function loadPassReservations(){
      api('/api/admin/pass-reservations').then(function(d){
        var lines = (d.ids || []).map(function(id){ return 'ID: ' + id; });
        document.getElementById('passIdsList').textContent = lines.join('\n') || 'Nenhum ID de reserva de Passe ainda.';
        document.getElementById('copyPassIds').onclick = function(){ if (lines.length) copyText(lines.join('\n')); };
      }).catch(function(e){ showToast(e.message, true); });
    }

    // ================= Produtos =================
    var productFormBox = document.getElementById('productFormBox');
    var productForm = document.getElementById('productForm');
    var variantsWrap = document.getElementById('p_variants');

    function variantRow(v){
      v = v || { label: '', price: '', dualId: false };
      var row = document.createElement('div');
      row.className = 'variant-item';
      row.innerHTML =
        '<div class="form-row">' +
          '<div><label>Rótulo (vazio = preço único)</label><input class="v_label" value="' + esc(v.label) + '" placeholder="Ex: 2 Passes"></div>' +
          '<div><label>Preço</label><input class="v_price" value="' + esc(v.price) + '" placeholder="R$ 0,00"></div>' +
        '</div>' +
        '<label class="check"><input type="checkbox" class="v_dual" ' + (v.dualId ? 'checked' : '') + '> Precisa de 2 IDs' +
        '<button type="button" class="remove-link" style="margin-left:auto">remover</button></label>';
      row.querySelector('.remove-link').addEventListener('click', function(){ row.remove(); });
      variantsWrap.appendChild(row);
    }
    document.getElementById('addVariantBtn').addEventListener('click', function(){ variantRow(); });

    function readVariants(){
      return Array.from(variantsWrap.querySelectorAll('.variant-item')).map(function(row){
        return {
          label: row.querySelector('.v_label').value,
          price: row.querySelector('.v_price').value,
          dualId: row.querySelector('.v_dual').checked
        };
      });
    }

    function resetProductForm(){
      document.getElementById('productFormTitle').textContent = 'Novo produto';
      document.getElementById('p_id').value = '';
      document.getElementById('p_category').value = '';
      document.getElementById('p_badge').value = '';
      document.getElementById('p_name').value = '';
      document.getElementById('p_desc').value = '';
      document.getElementById('p_image').value = '';
      document.getElementById('p_active').checked = true;
      variantsWrap.innerHTML = '';
      variantRow();
    }

    document.getElementById('newProductBtn').addEventListener('click', function(){
      resetProductForm();
      productFormBox.style.display = 'block';
      productFormBox.scrollIntoView({ behavior: 'smooth' });
    });
    document.getElementById('cancelProductBtn').addEventListener('click', function(){ productFormBox.style.display = 'none'; });

    function loadProducts(){
      api('/api/admin/products').then(function(rows){
        var grid = document.getElementById('productsGrid');
        grid.innerHTML = rows.map(function(p){
          var firstPrice = (p.variants && p.variants[0] && p.variants[0].price) || '';
          var img = p.image_public_url ? '<img src="' + esc(p.image_public_url) + '" alt="">' : '';
          return '<div class="product">' + img +
            '<b>' + esc(p.name) + '</b>' +
            '<span class="muted">' + esc(p.category) + (p.badge ? ' • ' + esc(p.badge) : '') + '</span>' +
            '<div class="price">' + esc(firstPrice) + (p.variants.length > 1 ? ' +' + (p.variants.length - 1) : '') + '</div>' +
            (p.active ? '' : '<span class="badge-off">Inativo</span>') +
            '<div class="row-btns">' +
              '<button class="btn btn-sm" data-edit="' + p.id + '">Editar</button>' +
              '<button class="btn btn-danger btn-sm" data-del="' + p.id + '">Excluir</button>' +
            '</div></div>';
        }).join('') || '<p class="muted">Nenhum produto cadastrado.</p>';

        window.__PRODUCTS_CACHE = rows;

        grid.querySelectorAll('[data-edit]').forEach(function(btn){
          btn.addEventListener('click', function(){ editProduct(btn.getAttribute('data-edit')); });
        });
        grid.querySelectorAll('[data-del]').forEach(function(btn){
          btn.addEventListener('click', function(){ deleteProduct(btn.getAttribute('data-del')); });
        });
      }).catch(function(e){ showToast(e.message, true); });
    }

    function editProduct(id){
      var p = (window.__PRODUCTS_CACHE || []).find(function(x){ return String(x.id) === String(id); });
      if (!p) return;
      document.getElementById('productFormTitle').textContent = 'Editar produto';
      document.getElementById('p_id').value = p.id;
      document.getElementById('p_category').value = p.category;
      document.getElementById('p_badge').value = p.badge || '';
      document.getElementById('p_name').value = p.name;
      document.getElementById('p_desc').value = p.description || '';
      document.getElementById('p_image').value = '';
      document.getElementById('p_active').checked = !!p.active;
      variantsWrap.innerHTML = '';
      (p.variants && p.variants.length ? p.variants : [{ label: '', price: '', dualId: false }]).forEach(variantRow);
      productFormBox.style.display = 'block';
      productFormBox.scrollIntoView({ behavior: 'smooth' });
    }

    function deleteProduct(id){
      if (!confirm('Excluir este produto? Essa ação não pode ser desfeita.')) return;
      api('/api/admin/products/' + id, { method: 'DELETE' })
        .then(function(){ showToast('Produto excluído.'); loadProducts(); })
        .catch(function(e){ showToast(e.message, true); });
    }

    productForm.addEventListener('submit', function(e){
      e.preventDefault();
      var id = document.getElementById('p_id').value;
      var fd = new FormData();
      fd.append('category', document.getElementById('p_category').value.toUpperCase());
      fd.append('name', document.getElementById('p_name').value);
      fd.append('desc', document.getElementById('p_desc').value);
      fd.append('badge', document.getElementById('p_badge').value);
      fd.append('active', document.getElementById('p_active').checked ? 'true' : 'false');
      fd.append('variants', JSON.stringify(readVariants()));
      var file = document.getElementById('p_image').files[0];
      if (file) fd.append('image', file);

      var url = id ? '/api/admin/products/' + id : '/api/admin/products';
      var method = id ? 'PUT' : 'POST';
      api(url, { method: method, body: fd })
        .then(function(){ showToast('Produto salvo!'); productFormBox.style.display = 'none'; loadProducts(); })
        .catch(function(e){ showToast(e.message, true); });
    });

    // ================= Clientes =================
    function loadCustomers(){
      api('/api/admin/customers').then(function(rows){
        var tbody = document.querySelector('#customersTable tbody');
        tbody.innerHTML = rows.map(function(c){
          return '<tr><td>' + esc(c.ffId) + '</td><td>' + esc(c.whatsapp || '—') + '</td><td>' + c.orders + '</td>' +
            '<td>' + esc((c.lastOrder || '').replace('T', ' ').slice(0, 16)) + '</td></tr>';
        }).join('') || '<tr><td colspan="4" class="muted">Nenhum cliente ainda.</td></tr>';
      }).catch(function(e){ showToast(e.message, true); });
    }

    // ================= Configurações =================
    function loadSettings(){
      api('/api/admin/settings').then(function(s){
        document.getElementById('s_name').value = s.name || '';
        document.getElementById('s_whatsapp').value = s.whatsapp || '';
        document.getElementById('s_pix').value = s.pix || '';
      }).catch(function(e){ showToast(e.message, true); });
    }
    document.getElementById('settingsForm').addEventListener('submit', function(e){
      e.preventDefault();
      api('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ name: document.getElementById('s_name').value, whatsapp: document.getElementById('s_whatsapp').value, pix: document.getElementById('s_pix').value })
      }).then(function(){ showToast('Configurações salvas!'); }).catch(function(e){ showToast(e.message, true); });
    });

    // ---- Troca de senha (senha atual OU código mestre) ----
    var pwMode = 'current';
    document.querySelectorAll('[data-pwmode]').forEach(function(btn){
      btn.addEventListener('click', function(){
        pwMode = btn.getAttribute('data-pwmode');
        document.querySelectorAll('[data-pwmode]').forEach(function(b){ b.classList.remove('on'); });
        btn.classList.add('on');
        document.getElementById('pw_currentWrap').style.display = pwMode === 'current' ? 'block' : 'none';
        document.getElementById('pw_recoveryWrap').style.display = pwMode === 'recovery' ? 'block' : 'none';
      });
    });
    document.getElementById('passwordForm').addEventListener('submit', function(e){
      e.preventDefault();
      var body = { newPassword: document.getElementById('pw_new').value };
      if (pwMode === 'current') body.currentPassword = document.getElementById('pw_current').value;
      else body.recoveryCode = document.getElementById('pw_recovery').value;

      api('/api/admin/change-password', { method: 'POST', body: JSON.stringify(body) })
        .then(function(){
          showToast('Senha alterada com sucesso!');
          document.getElementById('passwordForm').reset();
        }).catch(function(e){ showToast(e.message, true); });
    });

    // ---- Primeira carga ----
    loadDashboard();
  }
})();
