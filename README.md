# ESP Pose

Kamerayı acıp vucudun uzerine iskelet cizen basit bir web uygulaması. Her sey tarayıcıda calısıyor, sunucuya hicbir goruntu gitmiyor.

## Ozellikler

- Vucut iskeleti, eklem noktaları, kafa halkası ve el iskeleti
- 4 kisiye kadar aynı anda takip
- Can barı (kisinin boyu kadar)
- Renk secimi, RGB secenegi de var
- Ust, orta, alt ve dikey cizgiler
- On ve arka kamera, yatay gorunum
- Fotograf cekme, zamanlayıcı (3, 5, 10 sn) ve video kaydı
- Avuc yukarı bakarken basparmak ve isaret parmagını birlestirince fotograf ceker
- Ayarlar otomatik kaydolur, link ile de paylasılabilir

## Dosyalar

- `index.html` sayfanın kendisi
- `style.css` gorunum
- `script.js` butun mantık

## Bilgisayarda calıstırma

Dosyalara cift tıklayıp acma, calısmaz. Klasorde sunucu ac:

```
python -m http.server 8080
```

Sonra tarayıcıdan `http://localhost:8080` adresine gir.

## Telefondan veya baska bilgisayardan acma

Kamera sadece `https` ile acılan sitelerde calısır. Yerel sunucuyu internete acmak icin:

```
ssh -R 80:localhost:8080 nokey@localhost.run
```

Verdigi `https://...lhr.life` adresini telefonda ac. Bilgisayar ve terminal acık kaldıgı surece calısır, adres her seferinde degisir.

## Internete yukleme

Vercel, Netlify veya GitHub Pages ile yuklenebilir. Sadece su 3 dosya yeter:

- `index.html`
- `style.css`
- `script.js`

`key.pem`, `cert.pem` ve `server.pfx` dosyalarını hicbir yere yukleme.

## Calısmazsa

- Kamera acılmıyorsa adres `https` ile baslamalı
- Tarayıcıda kamera izni verilmis olmalı
- Modeller ilk acılısta internetten iner, baglantı lazım
- Chrome veya Safari guncel olmalı
