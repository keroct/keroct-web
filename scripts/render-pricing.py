from pathlib import Path
import json,re
root=Path(__file__).resolve().parents[1]
data=json.loads((root/'data/pricing.json').read_text(encoding='utf-8'))

def groups(entries):
    result=''
    for entry in entries:
        result+=f'<article class="price-group"><h3>{entry["name"]}</h3><dl>'
        for p in entry['plans']:
            result+=f'<div class="price-item"><dt>{p["name"]}</dt><dd class="price-value">{p["price"]}</dd>'
            if p['detail']:result+=f'<dd class="price-detail">{p["detail"]}</dd>'
            result+='</div>'
        result+='</dl></article>'
    return result
home=(root/'index.html').read_text(encoding='utf-8')
header=home[:home.index('<main')]
footer=home[home.index('<footer'):]
header=header.replace('KEROCT造船所 | 作品と、つくる人に出会う場所。','制作メニュー・料金 | KEROCT造船所').replace('href="assets/','href="../assets/').replace('href="index.html','href="../index.html').replace('href="pricing/','href="../pricing/')
footer=footer.replace('href="index.html','href="../index.html').replace('src="assets/','src="../assets/')
intro='''<main id="main"><section class="pricing-intro wrap"><a class="back-link" href="../index.html#services">← トップへ戻る</a><h1>制作メニュー・料金</h1><p>つくりたいものに合わせて、プランをお選びください。<br>詳しいご要望や制作条件は、ご相談時に確認します。</p><nav class="pricing-nav" aria-label="料金ページの目次"><a href="#design">デザイン</a><a href="#sets">セット料金</a><a href="#illustration">イラスト</a><a href="#options">オプション</a><a href="#conditions">制作条件</a></nav></section>'''
body='<section id="design" class="section wrap"><div class="section-heading"><h2>デザイン</h2><p>ロゴから配信画面まで、活動に必要なデザインを。</p></div><div class="pricing-grid">'+groups(data['design'])+'</div></section>'
body+='<section id="sets" class="section guide-section"><div class="wrap"><div class="section-heading"><h2>まとめてそろえる、セットプラン。</h2><p>すべてのセットにロゴプランC・サムネプランBと、修正3回が含まれます。</p></div><div class="sets-grid">'
for s in data['sets']:
    body+=f'<article class="set-plan"><h3>{s["name"]}</h3><p class="set-price">{s["price"]}</p><ul>'+''.join('<li>'+item+'</li>' for item in s['items'])+'</ul><p class="set-revisions">修正3回まで</p></article>'
body+='</div></div></section>'
body+='<section id="illustration" class="section wrap"><div class="section-heading"><h2>イラスト</h2><p>オリジナルの一枚から、カードや色紙まで。</p></div><div class="pricing-grid">'+groups(data['illustration'])+'</div></section>'
body+='<section id="options" class="section wrap"><div class="section-heading"><h2>オプション</h2><p>追加のご要望やお急ぎの場合に。</p></div><div class="options-grid">'
for p in data['options']:
    body+=f'<article class="option"><h3>{p["name"]}</h3><p class="option-price">{p["price"]}</p>'+(f'<p>{p["detail"]}</p>' if p['detail'] else '')+'</article>'
body+='</div></section>'
body+='<section id="conditions" class="section guide-section"><div class="wrap"><div class="section-heading"><h2>ご依頼の前に。</h2><p>納期・修正・追加料金について、ご確認ください。</p></div><ul class="conditions">'+''.join('<li>'+c+'</li>' for c in data['conditions'])+'</ul></div></section>'
body+='''<section class="contact-section wrap"><h2>つくりたいものが、見つかったら。</h2><p>その他の制作物についても、お気軽にご相談ください。</p><button class="button" data-contact>制作について相談する ↗</button></section></main>'''
pricing=root/'pricing';pricing.mkdir(exist_ok=True)
(pricing/'index.html').write_text(header+intro+body+footer,encoding='utf-8')
for path in [root/'index.html',root/'creators/kaerunoankake/index.html']:
    text=path.read_text(encoding='utf-8')
    prefix='../../' if 'creators' in str(path) else ''
    text=text.replace(f'href="{prefix}index.html#services">制作メニュー',f'href="{prefix}pricing/">制作メニュー・料金')
    if path==root/'index.html':
        replacement='''<section id="services" class="section wrap"><div class="section-heading"><h2>つくりたいものを、見つける。</h2><p>活動の顔になるロゴから、配信を彩るデザインまで。</p></div><div class="service-list"><a href="pricing/#design"><span class="service-name">ロゴデザイン<small>提案1案から</small></span><p class="service-price">¥6,000〜</p><span aria-hidden="true">↗</span></a><a href="pricing/#design"><span class="service-name">配信画面<small>STREAM DESIGN</small></span><p class="service-price">¥10,000</p><span aria-hidden="true">↗</span></a><a href="pricing/#illustration"><span class="service-name">オリジナルイラスト<small>サイズやご要望により変動</small></span><p class="service-price">¥8,000〜</p><span aria-hidden="true">↗</span></a></div><p class="service-note">通常納期は7〜14営業日程度。内容・点数により前後します。</p><a class="text-link" href="pricing/">全メニュー・料金を見る ↗</a></section>'''
        text=re.sub(r'<section id="services".*?</section>',replacement,text,flags=re.S)
    path.write_text(text,encoding='utf-8')
print('Added pricing page, source data, navigation and homepage prices.')
