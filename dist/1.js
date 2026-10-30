/*! Transit Hub v2.8.0 | Cloudflare Worker | built 2026-10-30T01:47:28.590Z */
export default {
  async fetch(request, env) {
    return await handleRequest(request, env)
  },
}

const VERSION = '2.8.0'
const CONFIG_KEY = 'config'
const USERS_KEY = 'users'
const MAX_NODES = 300
const MAX_BODY = 256 * 1024
const MAX_USERS = 20
/* 成员个人节点单独存一个 KV 键：不进管理员配置、不影响其他账号，
   只在该成员的配置、预览与订阅链接里合并展现 */
const PERSONAL_KEY_PREFIX = 'user_nodes:'
const MAX_PERSONAL_NODES = 100
const PERSONAL_ID_RE = /^p_[A-Za-z0-9_-]{1,62}$/
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._+@-]{2,253}$/
const USERNAME_MAX = 254
const PASSWORD_MIN = 12
const PASSWORD_MAX = 128
// Workers Free 只有 10ms CPU，默认 1 万次；付费计划可用 PASSWORD_ITERATIONS 提高（上限 20 万）
const PASSWORD_ITERATIONS = 10000
const PASSWORD_ITERATIONS_MAX = 200000

const MAIN_GROUP = '🌍选择节点'
const RESERVED_NAMES = new Set([
  MAIN_GROUP,
  '🇺🇸欧美节点',
  '🇯🇵日韩节点',
  '🇭🇰港台节点',
  '📶中转节点',
  '💬ChatGPT',
  'ⒼGoogle',
  '📺YOUTUBE',
  '📲 电报信息',
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
  'GLOBAL',
])

const REGION_META = {
  us: { group: '🇺🇸欧美节点', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/United_States.png' },
  jp: { group: '🇯🇵日韩节点', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Japan.png' },
  hk: { group: '🇭🇰港台节点', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Hong_Kong.png' },
  relay: { group: '📶中转节点', icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Relay.png' },
}
const REGION_ORDER = ['us', 'jp', 'hk', 'relay']
const REGIONS = ['us', 'jp', 'hk', 'relay', 'other']
const TYPES = ['vless', 'hysteria2', 'trojan', 'vmess', 'ss']
const TAGS = ['chatgpt', 'google', 'youtube', 'telegram']
/* 写入校验与 YAML 渲染共用同一套白名单，避免两处规则漂移 */
const NETWORKS = ['tcp', 'ws', 'grpc']
const FINGERPRINTS = ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random', 'randomized']
const CIPHERS = ['aes-128-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305']
const FLOWS = ['', 'xtls-rprx-vision']

const APP_GROUPS = [
  {
    key: 'chatgpt',
    name: '💬ChatGPT',
    icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/ChatGPT.png',
    bases: ['🇺🇸欧美节点'],
  },
  {
    key: 'google',
    name: 'ⒼGoogle',
    icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Google_Search.png',
    bases: ['🇺🇸欧美节点', '🇯🇵日韩节点', '📶中转节点'],
  },
  {
    key: 'youtube',
    name: '📺YOUTUBE',
    icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/YouTube.png',
    bases: ['🇺🇸欧美节点', '🇯🇵日韩节点', '🇭🇰港台节点', '📶中转节点'],
  },
  {
    key: 'telegram',
    name: '📲 电报信息',
    icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Telegram.png',
    bases: [MAIN_GROUP, '🇺🇸欧美节点', '🇯🇵日韩节点', '🇭🇰港台节点', '📶中转节点'],
  },
]

const STATIC_HEAD = `port: 7890
allow-lan: true
mode: rule
log-level: info
unified-delay: true
global-client-fingerprint: chrome
profile:
  store-selected: true      # 记忆策略组选择
  store-fake-ip: false      # 持久化 fake-ip
dns:
  enable: true
  listen: :53
  ipv6: true
  fake-ip-range: 198.18.0.1/16
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  fallback:
    - 8.8.8.8
    - 8.8.4.4
  fallback-filter:
    geoip: true
    geoip-code: CN
    ipcidr:
      - 240.0.0.0/4`
const STATIC_RULES = `rule-providers:
  reject:
    type: http
    behavior: domain
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/reject.txt"
    path: ./ruleset/reject.yaml
    interval: 86400
  icloud:
    type: http
    behavior: domain
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/icloud.txt"
    path: ./ruleset/icloud.yaml
    interval: 86400
  apple:
    type: http
    behavior: domain
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/apple.txt"
    path: ./ruleset/apple.yaml
    interval: 86400
  direct:
    type: http
    behavior: domain
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/direct.txt"
    path: ./ruleset/direct.yaml
    interval: 86400
  private:
    type: http
    behavior: domain
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/private.txt"
    path: ./ruleset/private.yaml
    interval: 86400
  gfw:
    type: http
    behavior: domain
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/gfw.txt"
    path: ./ruleset/gfw.yaml
    interval: 86400
  tld-not-cn:
    type: http
    behavior: domain
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/tld-not-cn.txt"
    path: ./ruleset/tld-not-cn.yaml
    interval: 86400
  cncidr:
    type: http
    behavior: ipcidr
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/cncidr.txt"
    path: ./ruleset/cncidr.yaml
    interval: 86400
  lancidr:
    type: http
    behavior: ipcidr
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/lancidr.txt"
    path: ./ruleset/lancidr.yaml
    interval: 86400
  applications:
    type: http
    behavior: classical
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/applications.txt"
    path: ./ruleset/applications.yaml
    interval: 86400
rules:
  - RULE-SET,applications,DIRECT
  - DOMAIN,clash.razord.top,DIRECT
  - DOMAIN,yacd.haishan.me,DIRECT
  - DOMAIN-SUFFIX,services.googleapis.cn,DIRECT
  - DOMAIN-SUFFIX,xn--ngstr-lra8j.com,DIRECT
  - RULE-SET,private,DIRECT
  - RULE-SET,reject,REJECT
  - RULE-SET,icloud,DIRECT
  - RULE-SET,apple,DIRECT
  - RULE-SET,direct,DIRECT
  - RULE-SET,lancidr,DIRECT
  - RULE-SET,cncidr,DIRECT
  - GEOIP,LAN,DIRECT
  - GEOIP,CN,DIRECT
  - DST-PORT,22,DIRECT
  - SRC-PORT,22,DIRECT
  - DST-PORT,22022,DIRECT
  - SRC-PORT,22022,DIRECT

 # 不需要代理的规则 (大陆网站)

  - IP-CIDR,185.188.32.0/24,DIRECT,no-resolve
  - IP-CIDR,185.188.33.0/24,DIRECT,no-resolve
  - IP-CIDR,185.188.34.0/24,DIRECT,no-resolve
  - IP-CIDR,185.188.35.0/24,DIRECT,no-resolve
  - IP-CIDR6,2a0b:b580::/48,DIRECT,no-resolve
  - IP-CIDR6,2a0b:b581::/48,DIRECT,no-resolve
  - IP-CIDR6,2a0b:b582::/48,DIRECT,no-resolve
  - IP-CIDR6,2a0b:b583::/48,DIRECT,no-resolve
  - IP-CIDR,182.254.116.0/24,DIRECT,no-resolve
  - DOMAIN-SUFFIX,12306.cn,DIRECT
  - DOMAIN-SUFFIX,12306.com,DIRECT
  - DOMAIN,integrate.api.nvidia.com,DIRECT
  - DOMAIN-SUFFIX,126.net,DIRECT
  - DOMAIN-SUFFIX,163.com,DIRECT
  - DOMAIN-SUFFIX,amd.com.cn,DIRECT
  - DOMAIN-SUFFIX,360.cn,DIRECT
  - DOMAIN-SUFFIX,360.com,DIRECT
  - DOMAIN-SUFFIX,360buy.com,DIRECT
  - DOMAIN-SUFFIX,360buyimg.com,DIRECT
  - DOMAIN-SUFFIX,36kr.com,DIRECT
  - DOMAIN-SUFFIX,58.com,DIRECT
  - DOMAIN-SUFFIX,8686c.com,DIRECT
  - DOMAIN-SUFFIX,abercrombie.com,DIRECT
  - DOMAIN-SUFFIX,acfun.tv,DIRECT
  - DOMAIN-SUFFIX,adobesc.com,DIRECT
  - DOMAIN-SUFFIX,air-matters.com,DIRECT
  - DOMAIN-SUFFIX,air-matters.io,DIRECT
  - DOMAIN-SUFFIX,aixifan.com,DIRECT
  - DOMAIN-SUFFIX,akadns.net,DIRECT
  - DOMAIN-SUFFIX,alibabacloud.com,DIRECT
  - DOMAIN-SUFFIX,alicdn.com,DIRECT
  - DOMAIN-SUFFIX,alipay.com,DIRECT
  - DOMAIN-SUFFIX,alipayobjects.com,DIRECT
  - DOMAIN-SUFFIX,aliyun.com,DIRECT
  - DOMAIN-SUFFIX,aliyuncs.com,DIRECT
  - DOMAIN-SUFFIX,amap.com,DIRECT
  - DOMAIN-SUFFIX,appshike.com,DIRECT
  - DOMAIN-SUFFIX,appstore.com,DIRECT
  - DOMAIN-SUFFIX,autonavi.com,DIRECT
  - DOMAIN-SUFFIX,aweme.snssdk.com,DIRECT
  - DOMAIN-SUFFIX,bababian.com,DIRECT
  - DOMAIN-SUFFIX,baidu.com,DIRECT
  - DOMAIN-SUFFIX,baidupcs.com,DIRECT
  - DOMAIN-SUFFIX,baiducotent.com,DIRECT
  - DOMAIN-SUFFIX,baidustatic.com,DIRECT
  - DOMAIN-SUFFIX,bcebos.com,DIRECT
  - DOMAIN-SUFFIX,gshifen.com,DIRECT
  - DOMAIN-SUFFIX,popin.cc,DIRECT
  - DOMAIN-SUFFIX,shifen.com,DIRECT
  - DOMAIN-SUFFIX,wshifen.com,DIRECT
  - DOMAIN-SUFFIX,bdimg.com,DIRECT
  - DOMAIN-SUFFIX,bdstatic.com,DIRECT
  - DOMAIN-SUFFIX,beatsbydre.com,DIRECT
  - DOMAIN-SUFFIX,bet365.com,DIRECT
  - DOMAIN-SUFFIX,broadcasthe.net,DIRECT
  - DOMAIN-SUFFIX,caiyunapp.com,DIRECT
  - DOMAIN-SUFFIX,ccgslb.com,DIRECT
  - DOMAIN-SUFFIX,ccgslb.net,DIRECT
  - DOMAIN-SUFFIX,chinacache.net,DIRECT
  - DOMAIN-SUFFIX,chunbo.com,DIRECT
  - DOMAIN-SUFFIX,chunboimg.com,DIRECT
  - DOMAIN-SUFFIX,clashroyaleapp.com,DIRECT
  - DOMAIN-SUFFIX,clouddn.com,DIRECT
  - DOMAIN-SUFFIX,cloudsigma.com,DIRECT
  - DOMAIN-SUFFIX,cloudxns.net,DIRECT
  - DOMAIN-SUFFIX,cmct.tv,DIRECT
  - DOMAIN-SUFFIX,cmfu.com,DIRECT
  - DOMAIN-SUFFIX,cnbeta.com,DIRECT
  - DOMAIN-SUFFIX,cnbetacdn.com,DIRECT
  - DOMAIN-SUFFIX,chdbits.co,DIRECT
  - DOMAIN-SUFFIX,cnlang.org,DIRECT
  - DOMAIN-SUFFIX,cz88.net,DIRECT
  - DOMAIN-SUFFIX,dct-cloud.com,DIRECT
  - DOMAIN-SUFFIX,didialift.com,DIRECT
  - DOMAIN-SUFFIX,digicert.com,DIRECT
  - DOMAIN-SUFFIX,douban.com,DIRECT
  - DOMAIN-SUFFIX,doubanio.com,DIRECT
  - DOMAIN-SUFFIX,douyin.com,DIRECT
  - DOMAIN-SUFFIX,douyu.com,DIRECT
  - DOMAIN-SUFFIX,douyu.tv,DIRECT
  - DOMAIN-SUFFIX,douyutv.com,DIRECT
  - DOMAIN-SUFFIX,duokan.com,DIRECT
  - DOMAIN-SUFFIX,duoshuo.com,DIRECT
  - DOMAIN-SUFFIX,dytt8.net,DIRECT
  - DOMAIN-SUFFIX,easou.com,DIRECT
  - DOMAIN-SUFFIX,ecitic.com,DIRECT
  - DOMAIN-SUFFIX,ecitic.net,DIRECT
  - DOMAIN-SUFFIX,eudic.net,DIRECT
  - DOMAIN-SUFFIX,ewqcxz.com,DIRECT
  - DOMAIN-SUFFIX,feng.com,DIRECT
  - DOMAIN-SUFFIX,fir.im,DIRECT
  - DOMAIN-SUFFIX,firefox.com,DIRECT
  - DOMAIN-SUFFIX,frdic.com,DIRECT
  - DOMAIN-SUFFIX,fresh-ideas.cc,DIRECT
  - DOMAIN-SUFFIX,gameloft.com,DIRECT
  - DOMAIN-SUFFIX,geetest.com,DIRECT
  - DOMAIN-SUFFIX,godic.net,DIRECT
  - DOMAIN-SUFFIX,goodread.com,DIRECT
  - DOMAIN-SUFFIX,gtimg.com,DIRECT
  - DOMAIN-SUFFIX,haibian.com,DIRECT
  - DOMAIN-SUFFIX,hao123.com,DIRECT
  - DOMAIN-SUFFIX,haosou.com,DIRECT
  - DOMAIN-SUFFIX,hdchina.org,DIRECT
  - DOMAIN-SUFFIX,hdcmct.org,DIRECT
  - DOMAIN-SUFFIX,hkserversolution.com,DIRECT
  - DOMAIN-SUFFIX,hollisterco.com,DIRECT
  - DOMAIN-SUFFIX,hongxiu.com,DIRECT
  - DOMAIN-SUFFIX,hxcdn.net,DIRECT
  - DOMAIN-SUFFIX,icedropper.com,DIRECT
  - DOMAIN-SUFFIX,iciba.com,DIRECT
  - DOMAIN-SUFFIX,ifeng.com,DIRECT
  - DOMAIN-SUFFIX,ifengimg.com,DIRECT
  - DOMAIN-SUFFIX,images-amazon.com,DIRECT
  - DOMAIN-SUFFIX,img4me.com,DIRECT
  - DOMAIN-SUFFIX,ithome.com,DIRECT
  - DOMAIN-SUFFIX,ixdzs.com,DIRECT
  - DOMAIN-SUFFIX,jd.com,DIRECT
  - DOMAIN-SUFFIX,jd.hk,DIRECT
  - DOMAIN-SUFFIX,jianshu.com,DIRECT
  - DOMAIN-SUFFIX,jianshu.io,DIRECT
  - DOMAIN-SUFFIX,jianshuapi.com,DIRECT
  - DOMAIN-SUFFIX,jiathis.com,DIRECT
  - DOMAIN-SUFFIX,jomodns.com,DIRECT
  - DOMAIN-SUFFIX,jsboxbbs.com,DIRECT
  - DOMAIN-SUFFIX,knewone.com,DIRECT
  - DOMAIN-SUFFIX,kuaidi100.com,DIRECT
  - DOMAIN-SUFFIX,kugou.com,DIRECT
  - DOMAIN-SUFFIX,lecloud.com,DIRECT
  - DOMAIN-SUFFIX,lemicp.com,DIRECT
  - DOMAIN-SUFFIX,letv.com,DIRECT
  - DOMAIN-SUFFIX,letvcloud.com,DIRECT
  - DOMAIN-SUFFIX,liyuans.com,DIRECT
  - DOMAIN-SUFFIX,lizhi.io,DIRECT
  - DOMAIN-SUFFIX,localizecdn.com,DIRECT
  - DOMAIN-SUFFIX,lucifr.com,DIRECT
  - DOMAIN-SUFFIX,luoo.net,DIRECT
  - DOMAIN-SUFFIX,lxdns.com,DIRECT
  - DOMAIN-SUFFIX,mai.tn,DIRECT
  - DOMAIN-SUFFIX,meizu.com,DIRECT
  - DOMAIN-SUFFIX,metatrader4.com,DIRECT
  - DOMAIN-SUFFIX,metatrader5.com,DIRECT
  - DOMAIN-SUFFIX,mi.com,DIRECT
  - DOMAIN-SUFFIX,miaopai.com,DIRECT
  - DOMAIN-SUFFIX,miui.com,DIRECT
  - DOMAIN-SUFFIX,miwifi.com,DIRECT
  - DOMAIN-SUFFIX,mob.com,DIRECT
  - DOMAIN-SUFFIX,moji.com,DIRECT
  - DOMAIN-SUFFIX,moke.com,DIRECT
  - DOMAIN-SUFFIX,mxhichina.com,DIRECT
  - DOMAIN-SUFFIX,myqcloud.com,DIRECT
  - DOMAIN-SUFFIX,myunlu.com,DIRECT
  - DOMAIN-SUFFIX,ngabbs.com,DIRECT
  - DOMAIN-SUFFIX,netease.com,DIRECT
  - DOMAIN-SUFFIX,nfoservers.com,DIRECT
  - DOMAIN-SUFFIX,nssurge.com,DIRECT
  - DOMAIN-SUFFIX,nuomi.com,DIRECT
  - DOMAIN-SUFFIX,ourbits.club,DIRECT
  - DOMAIN-SUFFIX,ourdvs.com,DIRECT
  - DOMAIN-SUFFIX,passthepopcorn.me,DIRECT
  - DOMAIN-SUFFIX,pgyer.com,DIRECT
  - DOMAIN-SUFFIX,pniao.com,DIRECT
  - DOMAIN-SUFFIX,privatehd.to,DIRECT
  - DOMAIN-SUFFIX,pstatp.com,DIRECT
  - DOMAIN-SUFFIX,qbox.me,DIRECT
  - DOMAIN-SUFFIX,qcloud.com,DIRECT
  - DOMAIN-SUFFIX,qdaily.com,DIRECT
  - DOMAIN-SUFFIX,qdmm.com,DIRECT
  - DOMAIN-SUFFIX,qhimg.com,DIRECT
  - DOMAIN-SUFFIX,qidian.com,DIRECT
  - DOMAIN-SUFFIX,qihucdn.com,DIRECT
  - DOMAIN-SUFFIX,qin.io,DIRECT
  - DOMAIN-SUFFIX,qingmang.me,DIRECT
  - DOMAIN-SUFFIX,qingmang.mobi,DIRECT
  - DOMAIN-SUFFIX,qiniucdn.com,DIRECT
  - DOMAIN-SUFFIX,qiniudn.com,DIRECT
  - DOMAIN-SUFFIX,qq.com,DIRECT
  - DOMAIN-SUFFIX,qqurl.com,DIRECT
  - DOMAIN-SUFFIX,rarbg.to,DIRECT
  - DOMAIN-SUFFIX,redacted.ch,DIRECT
  - DOMAIN-SUFFIX,rrmj.tv,DIRECT
  - DOMAIN-SUFFIX,ruguoapp.com,DIRECT
  - DOMAIN-SUFFIX,sandai.net,DIRECT
  - DOMAIN-SUFFIX,sf-express.com,DIRECT
  - DOMAIN-SUFFIX,sinaapp.com,DIRECT
  - DOMAIN-SUFFIX,sinaimg.cn,DIRECT
  - DOMAIN-SUFFIX,sinaimg.com,DIRECT
  - DOMAIN-SUFFIX,sm.ms,DIRECT
  - DOMAIN-SUFFIX,smzdm.com,DIRECT
  - DOMAIN-SUFFIX,snssdk.com,DIRECT
  - DOMAIN-SUFFIX,snwx.com,DIRECT
  - DOMAIN-SUFFIX,so.com,DIRECT
  - DOMAIN-SUFFIX,sogou.com,DIRECT
  - DOMAIN-SUFFIX,sogoucdn.com,DIRECT
  - DOMAIN-SUFFIX,sohu.com,DIRECT
  - DOMAIN-SUFFIX,soku.com,DIRECT
  - DOMAIN-SUFFIX,soso.com,DIRECT
  - DOMAIN-SUFFIX,sspai.com,DIRECT
  - DOMAIN-SUFFIX,startssl.com,DIRECT
  - DOMAIN-SUFFIX,suning.com,DIRECT
  - DOMAIN-SUFFIX,symcd.com,DIRECT
  - DOMAIN-SUFFIX,taobao.com,DIRECT
  - DOMAIN-SUFFIX,tawk.link,DIRECT
  - DOMAIN-SUFFIX,tawk.to,DIRECT
  - DOMAIN-SUFFIX,tenpay.com,DIRECT
  - DOMAIN-SUFFIX,tietuku.com,DIRECT
  - DOMAIN-SUFFIX,tmall.com,DIRECT
  - DOMAIN-SUFFIX,tmzvps.com,DIRECT
  - DOMAIN-SUFFIX,trello.com,DIRECT
  - DOMAIN-SUFFIX,trellocdn.com,DIRECT
  - DOMAIN-SUFFIX,totheglory.im,DIRECT
  - DOMAIN-SUFFIX,ttmeiju.com,DIRECT
  - DOMAIN-SUFFIX,tudou.com,DIRECT
  - DOMAIN-SUFFIX,udache.com,DIRECT
  - DOMAIN-SUFFIX,umengcloud.com,DIRECT
  - DOMAIN-SUFFIX,upaiyun.com,DIRECT
  - DOMAIN-SUFFIX,upyun.com,DIRECT
  - DOMAIN-SUFFIX,uxengine.net,DIRECT
  - DOMAIN-SUFFIX,wandoujia.com,DIRECT
  - DOMAIN-SUFFIX,weather.bjango.com,DIRECT
  - DOMAIN-SUFFIX,weather.com,DIRECT
  - DOMAIN-SUFFIX,webqxs.com,DIRECT
  - DOMAIN-SUFFIX,weibo.cn,DIRECT
  - DOMAIN-SUFFIX,weibo.com,DIRECT
  - DOMAIN-SUFFIX,weico.cc,DIRECT
  - DOMAIN-SUFFIX,weiphone.com,DIRECT
  - DOMAIN-SUFFIX,weiphone.net,DIRECT
  - DOMAIN-SUFFIX,wenku8.net,DIRECT
  - DOMAIN-SUFFIX,werewolf.53site.com,DIRECT
  - DOMAIN-SUFFIX,wkcdn.com,DIRECT
  - DOMAIN-SUFFIX,xdrig.com,DIRECT
  - DOMAIN-SUFFIX,xhostfire.com,DIRECT
  - DOMAIN-SUFFIX,xiami.com,DIRECT
  - DOMAIN-SUFFIX,xiami.net,DIRECT
  - DOMAIN-SUFFIX,xiaojukeji.com,DIRECT
  - DOMAIN-SUFFIX,xiaomi.com,DIRECT
  - DOMAIN-SUFFIX,xiaomi.net,DIRECT
  - DOMAIN-SUFFIX,xiaomicp.com,DIRECT
  - DOMAIN-SUFFIX,ximalaya.com,DIRECT
  - DOMAIN-SUFFIX,xitek.com,DIRECT
  - DOMAIN-SUFFIX,xmcdn.com,DIRECT
  - DOMAIN-SUFFIX,xslb.net,DIRECT
  - DOMAIN-SUFFIX,yach.me,DIRECT
  - DOMAIN-SUFFIX,yeepay.com,DIRECT
  - DOMAIN-SUFFIX,yhd.com,DIRECT
  - DOMAIN-SUFFIX,yinxiang.com,DIRECT
  - DOMAIN-SUFFIX,yixia.com,DIRECT
  - DOMAIN-SUFFIX,ykimg.com,DIRECT
  - DOMAIN-SUFFIX,youdao.com,DIRECT
  - DOMAIN-SUFFIX,youku.com,DIRECT
  - DOMAIN-SUFFIX,yunjiasu-cdn.net,DIRECT
  - DOMAIN-SUFFIX,zealer.com,DIRECT
  - DOMAIN-SUFFIX,zgslb.net,DIRECT
  - DOMAIN-SUFFIX,zhihu.com,DIRECT
  - DOMAIN-SUFFIX,zhimg.com,DIRECT
  - DOMAIN-SUFFIX,zimuzu.tv,DIRECT
  - DOMAIN-SUFFIX,zmz002.com,DIRECT
  - DOMAIN-SUFFIX,tanx.com,DIRECT
  - DOMAIN-SUFFIX,alibaba.com,DIRECT
  - DOMAIN-SUFFIX,iqiyi.com,DIRECT
  - DOMAIN-SUFFIX,gdtimg.com,DIRECT
  - DOMAIN-SUFFIX,gtimg.cn,DIRECT
  - DOMAIN-SUFFIX,tencent.com,DIRECT
  - DOMAIN-SUFFIX,nvidia.com,DIRECT

  # OpenAI (ChatGPT)
  - DOMAIN-SUFFIX,chat.openai.com,💬ChatGPT
  - DOMAIN-SUFFIX,auth0.openai.com,💬ChatGPT
  - DOMAIN-SUFFIX,cdn.openai.com,💬ChatGPT
  - DOMAIN-SUFFIX,openai.com,💬ChatGPT
  - DOMAIN-SUFFIX,ingest.sentry.io,💬ChatGPT
  - DOMAIN-SUFFIX,client.crisp.chat,💬ChatGPT
  - DOMAIN-SUFFIX,chatgpt.com,💬ChatGPT
  - DOMAIN-SUFFIX,oaistatic.com,💬ChatGPT
  - DOMAIN-SUFFIX,oaiusercontent.com,💬ChatGPT
  - DOMAIN-SUFFIX,api-iam.intercom.io,💬ChatGPT
  - DOMAIN-SUFFIX,cdn.oaistatic.com,💬ChatGPT
  - DOMAIN-SUFFIX,events.statsigapi.net,💬ChatGPT
  - DOMAIN-SUFFIX,featuregates.org,💬ChatGPT
  - DOMAIN-SUFFIX,js.intercomcdn.com,💬ChatGPT
  - DOMAIN-SUFFIX,tcr9i.chat.openai.com,💬ChatGPT
  - DOMAIN-SUFFIX,widget.intercom.io,💬ChatGPT

  # YouTube
  - DOMAIN-KEYWORD,youtube,📺YOUTUBE
  - DOMAIN,youtubei.googleapis.com,📺YOUTUBE
  - DOMAIN,yt3.ggpht.com,📺YOUTUBE
  - DOMAIN-SUFFIX,googlevideo.com,📺YOUTUBE
  - DOMAIN-SUFFIX,withyoutube.com,📺YOUTUBE
  - DOMAIN-SUFFIX,youtube-nocookie.com,📺YOUTUBE
  - DOMAIN-SUFFIX,youtube.com,📺YOUTUBE
  - DOMAIN-SUFFIX,youtubeeducation.com,📺YOUTUBE
  - DOMAIN-SUFFIX,youtubegaming.com,📺YOUTUBE
  - DOMAIN-SUFFIX,youtubekids.com,📺YOUTUBE
  - DOMAIN-SUFFIX,yt.be,📺YOUTUBE
  - DOMAIN-SUFFIX,gvt1.com,📺YOUTUBE
  - DOMAIN-SUFFIX,gvt2.com,📺YOUTUBE
  - DOMAIN-SUFFIX,youtu.be,📺YOUTUBE
  - DOMAIN-SUFFIX,ytimg.com,📺YOUTUBE
  - DOMAIN-SUFFIX,music.youtube.com,📺YOUTUBE

  # Google
  - DOMAIN-SUFFIX,1e100.net,ⒼGoogle
  - DOMAIN-SUFFIX,g.co,ⒼGoogle
  - DOMAIN-SUFFIX,google.com,ⒼGoogle
  - DOMAIN-SUFFIX,googleapis.com,ⒼGoogle
  - DOMAIN-SUFFIX,gstatic.com,ⒼGoogle
  - DOMAIN-SUFFIX,gv2.com,ⒼGoogle
  - DOMAIN-SUFFIX,gv3.com,ⒼGoogle
  - DOMAIN-SUFFIX,android.com,ⒼGoogle
  - DOMAIN-SUFFIX,withgoogle.com,ⒼGoogle
  - DOMAIN-SUFFIX,blogger.com,ⒼGoogle
  - DOMAIN-SUFFIX,waze.com,ⒼGoogle
  - DOMAIN-SUFFIX,gmail.com,ⒼGoogle
  - DOMAIN-KEYWORD,google,ⒼGoogle
  - DOMAIN-KEYWORD,businessmessages,ⒼGoogle
  - DOMAIN-KEYWORD,chrome,ⒼGoogle

  # Telegram
  - DOMAIN-KEYWORD,telegram,📲 电报信息
  - DOMAIN-SUFFIX,t.me,📲 电报信息
  - DOMAIN-SUFFIX,tx.me,📲 电报信息
  - DOMAIN-SUFFIX,tdesktop.com,📲 电报信息
  - DOMAIN-SUFFIX,telegra.ph,📲 电报信息
  - DOMAIN-SUFFIX,telegram.me,📲 电报信息
  - DOMAIN-SUFFIX,telegram.org,📲 电报信息
  - IP-CIDR,91.108.0.0/16,📲 电报信息,no-resolve
  - IP-CIDR,109.239.140.0/24,📲 电报信息,no-resolve
  - IP-CIDR,149.154.160.0/20,📲 电报信息,no-resolve
  - IP-CIDR6,2001:67c:4e8::/48,📲 电报信息,no-resolve
  - IP-CIDR6,2001:b28:f23d::/48,📲 电报信息,no-resolve
  - IP-CIDR6,2001:b28:f23f::/48,📲 电报信息,no-resolve
  - DOMAIN-SUFFIX,telesco.pe,📲 电报信息
  - IP-CIDR,91.108.4.0/22,📲 电报信息
  - IP-CIDR,91.108.8.0/22,📲 电报信息
  - IP-CIDR,91.108.12.0/22,📲 电报信息
  - IP-CIDR,91.108.16.0/22,📲 电报信息
  - IP-CIDR,91.108.20.0/22,📲 电报信息
  - IP-CIDR,91.108.56.0/22,📲 电报信息
  - MATCH,🌍选择节点`
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#f4f5fa">
<title>Transit Hub · 订阅控制台</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='11' fill='%234f46e5'/%3E%3Cpath d='M12 25.5 20 12l8 13.5-8 4.6-8-4.6Z' fill='none' stroke='white' stroke-width='1.8' stroke-linejoin='round'/%3E%3C/svg%3E">
<style nonce="__CSP_NONCE__">/* ==========================================================================
   Transit Hub · Subscription Console
   0. tokens   1. base   2. controls   3. auth   4. shell   5. overview
   6. nodes    7. preview   8. drawer   9. modal / toast   10. responsive
   11. bulk bar   12. row menu   13. share links   14. settings   15. users
   ========================================================================== */

/* ---------- 0. tokens ---------- */

:root {
  color-scheme: light;

  /* surfaces */
  --bg: #f4f5f9;
  --bg-tint-a: rgba(99, 102, 241, .07);
  --bg-tint-b: rgba(34, 211, 238, .05);
  --panel: #ffffff;
  --panel-soft: #fafbfd;
  --panel-inset: #f1f3f9;
  --line: #e8ebf2;
  --line-2: #dde2ec;
  --line-3: #c5ccda;

  /* ink ramp — 只留给真正的深色表面（代码块 / 登录故事板 / toast） */
  --ink-950: #05080f;
  --ink-900: #080d18;
  --ink-850: #0b1220;
  --ink-800: #0e1626;
  --ink-750: #121c2e;

  /* text */
  --text: #101828;
  --text-2: #344054;
  --muted: #5c6a80;
  --faint: #7b8798;

  /* accent —— 紫靛主色 + 青紫辅助色，用于渐变标识 */
  --accent: #5a4ff3;
  --accent-text: #4437d8;
  --accent-soft: #efedfe;
  --accent-soft-2: #ddd8fc;
  --accent-2: #8b5cf6;
  --accent-3: #22d3ee;
  --accent-grad: linear-gradient(135deg, #6d5bf6 0%, #5a4ff3 54%, #4b3ee4 100%);

  /* status: base = 图形/色块, ink = 小字号文字 */
  --success: #12b76a;
  --success-ink: #067647;
  --success-soft: #ecfdf3;
  --warning: #f79009;
  --warning-ink: #b54708;
  --warning-soft: #fffaeb;
  --danger: #f04438;
  --danger-ink: #b42318;
  --danger-soft: #fef3f2;

  /* sidebar —— 改版后是浅色面板，不再是深色渐层 */
  --side-bg: #ffffff;
  --side-bg-2: #fbfbfe;
  --side-line: #ebedf5;
  --side-text: #5c6a80;
  --side-text-strong: #131a2b;
  --side-caption: #8d97a9;
  --side-hover: #f4f6fb;
  --side-badge: #edeafe;
  --side-badge-text: #4a3ee0;

  /* hero —— 浅色 aurora 卡；下面 9 个变量同时驱动英雄区插画 */
  --hero-bg: #ffffff;
  --hero-line: rgba(99, 102, 241, .2);
  --hero-line-strong: rgba(99, 102, 241, .5);
  --hero-halo: rgba(124, 58, 237, .14);
  --hero-core: #ffffff;
  --hero-ring: #6366f1;
  --hero-node-bg: #ffffff;
  --hero-node-ring: rgba(99, 102, 241, .34);
  --hero-dot: #6366f1;
  --hero-label: #9aa2c6;

  /* elevation */
  --shadow-xs: 0 1px 2px rgba(16, 24, 40, .04);
  --shadow-sm: 0 1px 3px rgba(16, 24, 40, .06), 0 10px 24px -16px rgba(16, 24, 40, .18);
  --shadow-md: 0 20px 44px -26px rgba(16, 24, 40, .26), 0 2px 6px -2px rgba(16, 24, 40, .05);
  --shadow-lg: 0 40px 90px -44px rgba(15, 23, 42, .34);
  --hairline: inset 0 1px 0 rgba(255, 255, 255, .7);
  --ring: 0 0 0 3px var(--accent-soft-2);
  --ring-strong: 0 0 0 1px var(--accent), 0 0 0 4px var(--accent-soft);

  /* geometry —— 整体放大一档，卡片更「圆润」 */
  --r-1: 6px;
  --r-2: 9px;
  --r-3: 11px;
  --r-4: 13px;
  --r-5: 16px;
  --r-6: 20px;
  --r-7: 24px;
  --radius: 18px;
  --sidebar-w: 264px;
  --topbar-h: 64px;

  --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", "Microsoft YaHei", "Helvetica Neue", sans-serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}

html[data-theme="dark"] {
  color-scheme: dark;
  --bg: #070b13;
  --bg-tint-a: rgba(99, 102, 241, .12);
  --bg-tint-b: rgba(34, 211, 238, .07);
  --panel: #0d1524;
  --panel-soft: #101a2c;
  --panel-inset: #0a111e;
  --line: rgba(148, 163, 184, .12);
  --line-2: rgba(148, 163, 184, .19);
  --line-3: rgba(148, 163, 184, .3);

  --text: #e9eefb;
  --text-2: #c9d4e6;
  --muted: #93a2b8;
  --faint: #7d8ba1;

  --accent: #818cf8;
  --accent-text: #b6c0fb;
  --accent-soft: rgba(99, 102, 241, .14);
  --accent-soft-2: rgba(99, 102, 241, .26);
  --accent-grad: linear-gradient(135deg, #7c74f6 0%, #6366f1 54%, #524cd8 100%);

  --success: #34d399;
  --success-ink: #6ee7b7;
  --success-soft: rgba(16, 185, 129, .12);
  --warning: #fbbf24;
  --warning-ink: #fcd34d;
  --warning-soft: rgba(245, 158, 11, .11);
  --danger: #fb7185;
  --danger-ink: #fda4af;
  --danger-soft: rgba(244, 63, 94, .12);

  --side-bg: #0b1220;
  --side-bg-2: #080e19;
  --side-line: rgba(148, 163, 184, .11);
  --side-text: #93a4c0;
  --side-text-strong: #eef2fb;
  --side-caption: #64748b;
  --side-hover: rgba(255, 255, 255, .05);
  --side-badge: rgba(255, 255, 255, .07);
  --side-badge-text: #c7d2fe;

  --hero-bg: #0d1524;
  --hero-line: rgba(148, 163, 184, .15);
  --hero-line-strong: rgba(129, 140, 248, .44);
  --hero-halo: rgba(129, 140, 248, .26);
  --hero-core: #131d33;
  --hero-ring: #a5b4fc;
  --hero-node-bg: #101a2c;
  --hero-node-ring: rgba(148, 163, 184, .34);
  --hero-dot: #a5b4fc;
  --hero-label: #7d8ba1;

  --shadow-xs: 0 1px 2px rgba(0, 0, 0, .35);
  --shadow-sm: 0 2px 10px rgba(0, 0, 0, .4);
  --shadow-md: 0 20px 44px -22px rgba(0, 0, 0, .75);
  --shadow-lg: 0 44px 100px -44px rgba(0, 0, 0, .9);
  --hairline: inset 0 1px 0 rgba(255, 255, 255, .035);
  --ring: 0 0 0 3px var(--accent-soft-2);
  --ring-strong: 0 0 0 1px var(--accent), 0 0 0 4px var(--accent-soft);
}

/* ---------- 1. base ---------- */

*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  font-family: var(--font);
  font-size: 14px;
  line-height: 1.55;
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  font-feature-settings: "ss01" 1;
}
body.body-lock { overflow: hidden; }

h1, h2, h3, h4, p { margin: 0; }
button, input, select, textarea { font-family: inherit; }
button { -webkit-tap-highlight-color: transparent; }
code, kbd, pre { font-family: var(--mono); }
a { color: var(--accent-text); text-underline-offset: 2px; }

::selection { background: var(--accent-soft-2); color: var(--text); }
::-webkit-scrollbar { width: 9px; height: 9px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: var(--line-3);
  border-radius: 999px;
  border: 2.5px solid transparent;
  background-clip: content-box;
}
::-webkit-scrollbar-thumb:hover { background: var(--faint); background-clip: content-box; }
* { scrollbar-width: thin; scrollbar-color: var(--line-2) transparent; }

.svg-sprite { position: absolute; width: 0; height: 0; overflow: hidden; }
.icon {
  width: 18px;
  height: 18px;
  display: inline-block;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
  vertical-align: middle;
}
.icon-24 { width: 24px; height: 24px; }
.mono { font-family: var(--mono); }
.ta-right { text-align: right; }
.num { font-variant-numeric: tabular-nums; }

/* ---------- 2. controls ---------- */

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 38px;
  padding: 0 15px;
  border-radius: var(--r-3);
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -.006em;
  color: var(--text-2);
  cursor: pointer;
  white-space: nowrap;
  transition: background .16s ease, border-color .16s ease, color .16s ease,
              box-shadow .16s ease, transform .1s ease;
}
.btn .icon { width: 16px; height: 16px; }
.btn:focus-visible { outline: none; box-shadow: var(--ring-strong); }
.btn:active { transform: translateY(.5px); }
.btn:disabled { opacity: .5; cursor: not-allowed; transform: none; }

.btn-primary {
  background: var(--accent-grad);
  border-color: transparent;
  color: #fff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .16), 0 8px 18px -10px rgba(90, 79, 243, .8);
}
.btn-primary:hover { filter: brightness(1.06); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .18), 0 10px 22px -10px rgba(90, 79, 243, .9); }
.btn-primary:active { filter: brightness(.95); box-shadow: inset 0 2px 5px rgba(0, 0, 0, .22); }

.btn-secondary {
  background: var(--panel);
  border-color: var(--line-2);
  color: var(--text-2);
  box-shadow: var(--shadow-xs);
}
.btn-secondary:hover { background: var(--panel-soft); border-color: var(--line-3); color: var(--text); }

.btn-quiet { background: transparent; color: var(--muted); }
.btn-quiet:hover { background: var(--panel-inset); color: var(--text-2); }

.btn-danger {
  background: linear-gradient(180deg, #f2544a, #e8412f);
  border-color: #d92d20;
  color: #fff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .16), 0 1px 2px rgba(217, 45, 32, .28);
}
.btn-danger:hover { filter: brightness(.96); }

/* hero 现在是浅色卡：这两个类不再是「深色底上的按钮」，
   而是「主操作」与「次操作」在浅底上的两种形态 */
.btn-light {
  background: var(--accent-grad);
  border-color: transparent;
  color: #fff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .18), 0 10px 22px -12px rgba(90, 79, 243, .85);
}
.btn-light:hover { filter: brightness(1.06); }
.btn-ghost-light {
  background: var(--panel);
  border-color: var(--line-2);
  color: var(--text-2);
  box-shadow: var(--shadow-xs);
}
.btn-ghost-light:hover { background: var(--panel); border-color: var(--line-3); color: var(--text); }

.btn-sm { height: 34px; padding: 0 12px; font-size: 12px; border-radius: var(--r-2); gap: 6px; }
.btn-sm .icon { width: 14px; height: 14px; }
.btn-lg { height: 46px; border-radius: var(--r-4); font-size: 13.5px; }
.btn-block { width: 100%; }
.btn.is-loading { pointer-events: none; }
.btn.is-loading .btn-label { opacity: .72; }

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  display: inline-block;
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.icon-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--r-2);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  transition: background .14s ease, color .14s ease, box-shadow .14s ease;
  flex: none;
}
.icon-btn:hover { background: var(--panel-inset); color: var(--text); }
.icon-btn:focus-visible { outline: none; box-shadow: var(--ring); }
.icon-btn .icon { width: 16px; height: 16px; }
.icon-btn.danger:hover { background: var(--danger-soft); color: var(--danger-ink); }
.icon-btn:disabled { opacity: .28; cursor: not-allowed; }
.icon-btn:disabled:hover { background: none; color: inherit; }

input, select {
  width: 100%;
  height: 42px;
  padding: 0 12px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-3);
  background: var(--panel);
  color: var(--text);
  font-size: 13px;
  transition: border-color .16s ease, box-shadow .16s ease, background .16s ease;
}
input::placeholder { color: var(--faint); }
input:hover, select:hover { border-color: var(--line-3); }
input:focus, select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
input[type="number"]::-webkit-outer-spin-button,
input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
input[type="number"] { -moz-appearance: textfield; appearance: textfield; }
input[type="search"]::-webkit-search-cancel-button { -webkit-appearance: none; }

.select-wrap { position: relative; display: inline-flex; align-items: center; }
.select-wrap select {
  appearance: none;
  -webkit-appearance: none;
  padding-right: 30px;
  cursor: pointer;
}
.select-wrap > .icon {
  position: absolute;
  right: 9px;
  width: 13px;
  height: 13px;
  color: var(--faint);
  pointer-events: none;
  transition: color .14s ease;
}
.select-wrap:hover > .icon { color: var(--muted); }
.select-block { width: 100%; }
.select-block select { width: 100%; }
.select-wrap select option { background: var(--panel); color: var(--text); }

.switch {
  position: relative;
  width: 40px;
  height: 23px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--line-3);
  cursor: pointer;
  transition: background .18s ease;
  flex: none;
}
.switch::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(16, 24, 40, .26);
  transition: transform .18s cubic-bezier(.2, .8, .2, 1);
}
.switch[aria-checked="true"] {
  background: linear-gradient(180deg, #6259ef, #4f46e5);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, .14);
}
.switch[aria-checked="true"]::after { transform: translateX(17px); }
.switch:hover { background: var(--line-3); }
.switch[aria-checked="true"]:hover { background: linear-gradient(180deg, #6b62f3, #554cea); }
.switch:focus-visible { outline: none; box-shadow: var(--ring-strong); }
.switch:disabled { opacity: .45; cursor: not-allowed; }
html[data-theme="dark"] .switch { background: rgba(148, 163, 184, .26); }
html[data-theme="dark"] .switch[aria-checked="true"] { background: linear-gradient(180deg, #8b93fb, #6f74f0); }
html[data-theme="dark"] .switch::after { background: #f8fafc; }

.field { margin-bottom: 15px; min-width: 0; }
.field > label {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 7px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: -.005em;
  color: var(--text-2);
}
.req { color: var(--danger); }
.field-hint { margin-top: 6px; font-size: 11px; color: var(--faint); line-height: 1.6; }
.field-hint code,
.field-error code { padding: 1px 5px; border-radius: 4px; background: var(--panel-inset); border: 1px solid var(--line); font-size: 10.5px; }
.field-error { display: none; margin-top: 6px; font-size: 11.5px; color: var(--danger-ink); line-height: 1.5; }
.field.has-error input,
.field.has-error select,
.field.has-error textarea { border-color: var(--danger); box-shadow: 0 0 0 3px var(--danger-soft); }
.field.has-error .field-error { display: block; }
.field-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.field-row .field { margin-bottom: 15px; }
.field-row:has(.field-port) { grid-template-columns: minmax(0, 1fr) 120px; }
.input-inline { display: flex; align-items: center; gap: 8px; }
.input-inline input { flex: 1; min-width: 0; }
.input-inline .btn {
  height: 42px;
  flex: none;
  border: 1px solid var(--line-2);
  background: var(--panel-soft);
  color: var(--text-2);
}
.input-inline .btn:hover { background: var(--panel-inset); border-color: var(--line-3); }
.token-input { font-family: var(--mono); font-size: 11.5px; letter-spacing: .015em; }

.form-error {
  background: var(--danger-soft);
  border: 1px solid color-mix(in srgb, var(--danger) 22%, transparent);
  color: var(--danger-ink);
  font-size: 12px;
  line-height: 1.55;
  padding: 10px 12px;
  border-radius: var(--r-2);
}
.form-error-block { margin-top: 4px; }

.eyebrow {
  display: block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .15em;
  text-transform: uppercase;
  color: var(--accent-text);
  margin-bottom: 9px;
}
.eyebrow-light { color: #a5b4fc; }

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 16%, transparent);
  flex: none;
}
.status-dot.is-warning { background: var(--warning); box-shadow: 0 0 0 3px color-mix(in srgb, var(--warning) 18%, transparent); }

/* ---------- 3. auth ---------- */

.auth-screen {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 36px 24px;
  overflow: hidden;
  background:
    radial-gradient(900px 520px at 10% -10%, rgba(99, 102, 241, .11), transparent 62%),
    radial-gradient(820px 480px at 100% 104%, rgba(14, 165, 233, .08), transparent 62%),
    var(--bg);
}
html[data-theme="dark"] .auth-screen {
  background:
    radial-gradient(900px 520px at 10% -10%, rgba(99, 102, 241, .17), transparent 62%),
    radial-gradient(820px 480px at 100% 104%, rgba(14, 165, 233, .11), transparent 62%),
    var(--bg);
}
.auth-aurora { position: fixed; inset: 0; overflow: hidden; pointer-events: none; }
.aurora { position: absolute; border-radius: 50%; filter: blur(110px); opacity: .5; }
.aurora.a { width: 520px; height: 520px; left: -150px; top: -190px; background: rgba(99, 102, 241, .22); }
.aurora.b { width: 460px; height: 460px; right: -130px; bottom: -190px; background: rgba(14, 165, 233, .14); }
.aurora.c { width: 320px; height: 320px; right: 22%; top: 24%; background: rgba(168, 85, 247, .10); }

.auth-shell {
  position: relative;
  z-index: 1;
  width: min(1020px, 100%);
  display: grid;
  grid-template-columns: 1.04fr .96fr;
  min-height: 600px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--r-7);
  overflow: hidden;
  box-shadow: var(--shadow-lg), 0 0 0 1px rgba(16, 24, 40, .02);
}
.auth-story {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 36px 40px 30px;
  color: #e8eefb;
  background:
    radial-gradient(120% 120% at 0% 0%, #241f5e 0%, #141b38 46%, #0a1020 100%);
}
.auth-story::after {
  content: "";
  position: absolute;
  inset: 0;
  border-right: 1px solid rgba(255, 255, 255, .06);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .06);
  pointer-events: none;
}
.auth-story-art { position: absolute; inset: 0; pointer-events: none; }
.auth-story-art svg { width: 100%; height: 100%; display: block; }
.auth-story-top { position: relative; z-index: 1; display: flex; align-items: center; gap: 10px; }
.brand-tile { width: 30px; height: 30px; display: inline-flex; }
.brand-tile .icon { width: 30px; height: 30px; }
.brand-word { font-size: 15px; font-weight: 650; letter-spacing: -.01em; color: #f1f5ff; }
.auth-story-copy { position: relative; z-index: 1; margin: 52px 0 auto; max-width: 400px; }
.auth-story h1 {
  font-size: 33px;
  line-height: 1.26;
  letter-spacing: -.035em;
  font-weight: 640;
  color: #f8fafc;
  margin: 14px 0 12px;
}
.auth-story-copy > p { font-size: 13px; line-height: 1.78; color: #98a7c5; margin: 0 0 30px; max-width: 348px; }
.auth-points { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 15px; }
.auth-points li { display: flex; gap: 12px; align-items: flex-start; }
.point-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--r-3);
  background: rgba(129, 140, 248, .12);
  border: 1px solid rgba(129, 140, 248, .18);
  color: #a5b4fc;
  display: grid;
  place-items: center;
  flex: none;
}
.point-icon .icon { width: 15px; height: 15px; }
.auth-points b { display: block; font-size: 12.5px; font-weight: 600; color: #dce4f8; margin-bottom: 2px; }
.auth-points small { display: block; font-size: 11px; color: #7f8fae; line-height: 1.55; }
.auth-story-foot {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 32px;
  font-size: 10.5px;
  letter-spacing: .02em;
  color: #71819f;
}
.auth-story-foot .status-dot { width: 6px; height: 6px; background: #34d399; }

.auth-panel { display: flex; flex-direction: column; justify-content: center; padding: 54px 50px; background: var(--panel); }
.auth-form-head { margin-bottom: 26px; }
.auth-form-head h2 { font-size: 24px; font-weight: 650; letter-spacing: -.03em; margin: 0 0 8px; }
.auth-form-head p { font-size: 12.5px; color: var(--muted); line-height: 1.65; }
.auth-panel .field { margin-bottom: 16px; }
.input-wrap { position: relative; display: flex; align-items: center; }
.input-wrap input {
  height: 46px;
  padding-left: 38px;
  padding-right: 42px;
  font-size: 13.5px;
  border-radius: var(--r-4);
  background: var(--panel-inset);
  border-color: var(--line);
}
.input-wrap input:hover { border-color: var(--line-2); background: var(--panel-soft); }
.input-wrap input:focus { background: var(--panel); border-color: var(--accent); }
.input-prefix { position: absolute; left: 12px; display: flex; color: var(--faint); pointer-events: none; }
.input-prefix .icon { width: 15px; height: 15px; }
.input-suffix {
  position: absolute;
  right: 6px;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--r-1);
  background: none;
  color: var(--faint);
  cursor: pointer;
  transition: background .14s ease, color .14s ease;
}
.input-suffix:hover { background: var(--panel-soft); color: var(--text-2); }
.input-suffix .icon { width: 15px; height: 15px; }
.auth-panel .form-error { margin-bottom: 12px; }
.auth-note { display: flex; gap: 7px; align-items: flex-start; margin-top: 16px; font-size: 11.5px; color: var(--faint); line-height: 1.6; }
.auth-note .icon { width: 14px; height: 14px; flex: none; margin-top: 1px; color: var(--success); }
.auth-help { margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--line); font-size: 11px; color: var(--faint); line-height: 1.7; }
.auth-help code { font-family: var(--mono); font-size: 10.5px; background: var(--panel-inset); border: 1px solid var(--line); padding: 1px 5px; border-radius: 4px; color: var(--text-2); }
.auth-footer { position: relative; z-index: 1; margin-top: 22px; font-size: 10.5px; letter-spacing: .03em; color: var(--faint); }

/* ---------- 4. shell ---------- */

.app {
  min-height: 100vh;
  display: grid;
  grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
  background:
    radial-gradient(1200px 520px at 14% -16%, var(--bg-tint-a), transparent 62%),
    radial-gradient(900px 460px at 102% -8%, var(--bg-tint-b), transparent 60%),
    var(--bg);
  background-attachment: fixed;
}

/* 侧栏改成浅色面板：改版前是深色渐层，和右侧白色卡片是两套语言；
   现在侧栏 / 顶栏 / 卡片共用一套浅色底，只靠 1px 细线分隔 */
.sidebar {
  position: sticky;
  top: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 26px;
  padding: 20px 16px 18px;
  background: linear-gradient(180deg, var(--side-bg) 0%, var(--side-bg-2) 100%);
  border-right: 1px solid var(--side-line);
  overflow-y: auto;
  z-index: 40;
}
.sidebar::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 260px;
  background: radial-gradient(280px 170px at 22% 0%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 78%);
  pointer-events: none;
}
.sidebar::-webkit-scrollbar-thumb { background: var(--line-2); background-clip: content-box; }

.side-head { position: relative; display: flex; align-items: center; gap: 10px; padding: 6px 8px 0; }
.logo-tile { display: inline-flex; width: 34px; height: 34px; flex: none; border-radius: var(--r-3); box-shadow: 0 8px 18px -8px color-mix(in srgb, var(--accent) 70%, transparent); }
.logo-tile .icon { width: 34px; height: 34px; }
.logo-copy { min-width: 0; display: flex; flex-direction: column; }
.logo-copy strong { font-size: 14px; font-weight: 650; letter-spacing: -.014em; color: var(--side-text-strong); line-height: 1.35; }
.logo-copy span { font-size: 9px; letter-spacing: .1em; color: var(--side-caption); text-transform: uppercase; white-space: nowrap; }

.side-nav { position: relative; display: flex; flex-direction: column; gap: 3px; }
.nav-caption {
  font-size: 9.5px;
  font-weight: 650;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--side-caption);
  padding: 0 12px 9px;
}
.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  height: 42px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--r-3);
  background: transparent;
  color: var(--side-text);
  font-size: 13px;
  font-weight: 550;
  letter-spacing: -.004em;
  text-align: left;
  cursor: pointer;
  transition: background .16s ease, color .16s ease, border-color .16s ease, box-shadow .16s ease;
}
.nav-item .icon { width: 17px; height: 17px; opacity: .9; transition: opacity .16s ease, transform .16s ease; }
.nav-item:hover { background: var(--side-hover); color: var(--side-text-strong); }
.nav-item:hover .icon { opacity: 1; }
.nav-item:focus-visible { outline: none; box-shadow: var(--ring-strong); }
.nav-item.is-active {
  background: var(--accent-grad);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 10px 22px -14px color-mix(in srgb, var(--accent) 90%, transparent), inset 0 1px 0 rgba(255, 255, 255, .16);
}
.nav-item.is-active .icon { color: #fff; opacity: 1; }
.nav-item.is-active::before { display: none; }
.nav-text { min-width: 0; }
.nav-badge {
  margin-left: auto;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--side-badge);
  color: var(--side-badge-text);
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.nav-item.is-active .nav-badge { background: rgba(255, 255, 255, .22); color: #fff; }

.side-foot { position: relative; margin-top: auto; display: flex; flex-direction: column; gap: 5px; }
.storage-card {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: var(--r-4);
  border: 1px solid var(--line);
  background: var(--panel-inset);
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
  transition: border-color .16s ease, background .16s ease, box-shadow .16s ease;
}
.storage-card:hover { background: var(--panel); border-color: var(--line-2); box-shadow: var(--shadow-xs); }
.storage-card .status-dot { width: 7px; height: 7px; box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 14%, transparent); }
.storage-copy { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.storage-copy small { font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }
.storage-copy strong { font-size: 12px; font-weight: 600; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.storage-chevron { width: 13px; height: 13px; color: var(--faint); transform: rotate(-90deg); transition: color .14s ease, transform .14s ease; }
.storage-card:hover .storage-chevron { color: var(--accent-text); transform: rotate(-90deg) translateX(1px); }
.storage-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 12px;
  border: 0;
  background: none;
  color: var(--faint);
  font-size: 10.5px;
  text-align: left;
  cursor: pointer;
  line-height: 1.5;
  transition: color .14s ease;
}
.storage-hint:hover { color: var(--accent-text); }
.storage-hint .icon { width: 13px; height: 13px; flex: none; }
.side-actions {
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--side-line);
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.side-action {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--r-2);
  background: none;
  color: var(--side-text);
  font-size: 12px;
  cursor: pointer;
  transition: background .14s ease, color .14s ease;
}
.side-action:hover { background: var(--side-hover); color: var(--side-text-strong); }
.side-action .icon { width: 15px; height: 15px; }
.mobile-action { display: none; }

.workspace { min-width: 0; display: flex; flex-direction: column; }
.topbar {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: var(--topbar-h);
  padding: 0 34px;
  border-bottom: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
  background: color-mix(in srgb, var(--bg) 74%, transparent);
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
}
.crumbs { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--faint); min-width: 0; }
.crumbs strong { color: var(--text-2); font-weight: 600; }
.crumb-sep { color: var(--line-3); }
.top-actions { display: flex; align-items: center; gap: 8px; }
.mode-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--success) 22%, transparent);
  background: var(--success-soft);
  color: var(--success-ink);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.mode-pill .status-dot { width: 6px; height: 6px; background: currentColor; box-shadow: none; }
.mode-pill.is-warning {
  color: var(--warning-ink);
  background: var(--warning-soft);
  border-color: color-mix(in srgb, var(--warning) 26%, transparent);
}

.content { width: 100%; max-width: 1480px; margin: 0 auto; padding: 34px 34px 80px; }
.view { animation: viewIn .3s cubic-bezier(.2, .8, .2, 1) both; }
@keyframes viewIn { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }

.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 28px;
  margin-bottom: 26px;
}
.page-head > div:first-child { min-width: 0; max-width: 68ch; }
.page-head h1 { font-size: 29px; font-weight: 660; letter-spacing: -.034em; line-height: 1.16; margin: 0 0 8px; }
.page-sub { font-size: 12.5px; color: var(--muted); line-height: 1.7; }
.page-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: none; padding-top: 20px; }
.page-head-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; font-size: 11px; color: var(--faint); white-space: nowrap; flex: none; padding-top: 4px; }
.status-inline { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: var(--success-ink); font-size: 11px; }
.status-inline .status-dot { width: 6px; height: 6px; box-shadow: none; }

.alert {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 13px 16px;
  border-radius: var(--r-4);
  border: 1px solid color-mix(in srgb, var(--warning) 26%, transparent);
  background: var(--warning-soft);
}
.alert-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--r-2);
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--warning) 14%, transparent);
  color: var(--warning-ink);
  flex: none;
}
.alert-icon .icon { width: 16px; height: 16px; }
.alert-copy { flex: 1; min-width: 0; }
.alert-copy strong { display: block; font-size: 12.5px; font-weight: 650; color: var(--text); margin-bottom: 2px; }
.alert-copy p { font-size: 11.5px; color: var(--muted); line-height: 1.6; }
.alert-copy code { font-family: var(--mono); font-size: 10.5px; background: color-mix(in srgb, var(--warning) 12%, transparent); border-radius: 4px; padding: 1px 5px; }
.alert-danger { border-color: color-mix(in srgb, var(--danger) 26%, transparent); background: var(--danger-soft); }
.alert-danger .alert-icon { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger-ink); }
.alert-danger .alert-copy code { background: color-mix(in srgb, var(--danger) 12%, transparent); }

/* ---------- 5. overview ---------- */

/* hero 由深色夜景改为浅色 aurora 卡：白底 + 紫/青双色光晕，
   文字回到深色，插画线条改为淡靛蓝（颜色全部走 --hero-* 变量） */
.hero {
  position: relative;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(280px, .85fr);
  gap: 28px;
  padding: 34px 36px 32px;
  margin-bottom: 18px;
  border-radius: var(--r-7);
  border: 1px solid color-mix(in srgb, var(--accent) 16%, var(--line));
  background:
    radial-gradient(122% 130% at 0% 0%,
      color-mix(in srgb, var(--accent) 8%, var(--hero-bg)) 0%,
      color-mix(in srgb, var(--accent) 3%, var(--hero-bg)) 48%,
      var(--hero-bg) 100%);
  box-shadow:
    0 1px 2px rgba(16, 24, 40, .04),
    0 36px 64px -48px color-mix(in srgb, var(--accent) 60%, transparent),
    var(--hairline);
  color: var(--text);
}
.hero::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(color-mix(in srgb, var(--accent) 8%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--accent) 8%, transparent) 1px, transparent 1px);
  background-size: 36px 36px;
  mask-image: radial-gradient(ellipse at 10% 4%, #000, transparent 72%);
  -webkit-mask-image: radial-gradient(ellipse at 10% 4%, #000, transparent 72%);
  pointer-events: none;
}
.hero::after {
  content: "";
  position: absolute;
  right: -250px;
  top: -310px;
  width: 720px;
  height: 720px;
  border-radius: 50%;
  background:
    radial-gradient(circle at 44% 46%, color-mix(in srgb, var(--accent-2) 15%, transparent), transparent 62%),
    radial-gradient(circle at 70% 66%, color-mix(in srgb, var(--accent-3) 11%, transparent), transparent 60%);
  pointer-events: none;
}
.hero-copy { position: relative; z-index: 1; min-width: 0; }
.hero-status { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 600; color: var(--success-ink); letter-spacing: .01em; }
.live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 16%, transparent); flex: none; }
.hero-version {
  margin-left: 2px;
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--line);
  padding: 2px 7px;
  border-radius: 6px;
}
.hero h2 { margin: 16px 0 11px; font-size: clamp(25px, 2.5vw, 33px); line-height: 1.24; letter-spacing: -.036em; font-weight: 660; color: var(--text); }
.hero p { max-width: 520px; margin: 0 0 22px; font-size: 12.5px; line-height: 1.74; color: var(--muted); }
.hero-actions { display: flex; gap: 9px; margin-bottom: 24px; flex-wrap: wrap; }
.hero-br { display: block; }
.sub-card {
  max-width: 580px;
  padding: 13px 15px;
  border-radius: var(--r-4);
  border: 1px solid var(--line);
  background: var(--panel);
  box-shadow: var(--shadow-xs);
}
.sub-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 9px; font-size: 9.5px; font-weight: 650; letter-spacing: .1em; text-transform: uppercase; color: var(--faint); }
.sub-card-head span:last-child { text-transform: none; letter-spacing: 0; font-weight: 400; color: var(--faint); font-size: 10px; }
.sub-input { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border-radius: var(--r-2); border: 1px solid var(--line); background: var(--panel-inset); }
.sub-input > .icon { width: 14px; height: 14px; color: var(--faint); flex: none; }
.sub-input code { flex: 1; min-width: 0; font-family: var(--mono); font-size: 11px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sub-icon-btn { width: 26px; height: 26px; display: grid; place-items: center; border: 0; border-radius: var(--r-1); background: none; color: var(--faint); cursor: pointer; flex: none; transition: background .14s ease, color .14s ease; }
.sub-icon-btn:hover { background: var(--line); color: var(--text); }
.sub-icon-btn:disabled { opacity: .35; cursor: not-allowed; }
.sub-icon-btn .icon { width: 14px; height: 14px; }
.hero-visual { position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; min-width: 0; }
.hero-visual svg { width: 100%; max-width: 420px; height: auto; }
.hero-visual-meta {
  position: absolute;
  right: 2px;
  bottom: 2px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  padding: 8px 13px 9px;
  border-radius: var(--r-3);
  border: 1px solid var(--line);
  background: color-mix(in srgb, var(--panel) 86%, transparent);
  backdrop-filter: blur(10px);
  box-shadow: var(--shadow-xs);
}
.hero-visual-meta span { font-size: 8px; font-weight: 650; letter-spacing: .18em; color: var(--faint); }
.hero-visual-meta strong { font-family: var(--mono); font-size: 23px; font-weight: 600; color: var(--accent-text); line-height: 1.2; }

/* 统计卡：从「四张一模一样的白卡」改成按 --tone 着色的浅色瓷砖，
   每张自带一层角部光晕，四张卡并排时能看出是一组 */
.stat-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-bottom: 18px; }
.stat-card {
  position: relative;
  overflow: hidden;
  padding: 20px 22px 19px;
  background: linear-gradient(160deg, color-mix(in srgb, var(--tone, var(--accent)) 9%, var(--panel)) 0%, var(--panel) 66%);
  border: 1px solid color-mix(in srgb, var(--tone, var(--accent)) 18%, var(--line));
  border-radius: var(--radius);
  box-shadow: var(--shadow-xs), var(--hairline);
  transition: transform .22s cubic-bezier(.2, .8, .2, 1), box-shadow .22s ease, border-color .22s ease;
}
.stat-card::before {
  content: "";
  position: absolute;
  right: -44px;
  top: -60px;
  width: 180px;
  height: 180px;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--tone, var(--accent)) 20%, transparent), transparent 68%);
  pointer-events: none;
  transition: transform .3s cubic-bezier(.2, .8, .2, 1), opacity .3s ease;
}
.stat-card::after { display: none; }
.stat-card:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--tone, var(--accent)) 34%, var(--line)); box-shadow: var(--shadow-sm), var(--hairline); }
.stat-card:hover::before { transform: scale(1.14); }
.stat-card[data-tone="indigo"] { --tone: #6366f1; }
.stat-card[data-tone="emerald"] { --tone: #12b76a; }
.stat-card[data-tone="cyan"] { --tone: #0891b2; }
.stat-card[data-tone="amber"] { --tone: #f59e0b; }
.stat-top { position: relative; display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.stat-icon { width: 36px; height: 36px; border-radius: var(--r-3); display: grid; place-items: center; flex: none; }
.stat-icon .icon { width: 17px; height: 17px; }
.tone-indigo { background: var(--accent-soft); color: var(--accent-text); }
.tone-emerald { background: var(--success-soft); color: var(--success-ink); }
.tone-cyan { background: rgba(14, 165, 233, .10); color: #0369a1; }
html[data-theme="dark"] .tone-cyan { color: #38bdf8; }
.tone-amber { background: var(--warning-soft); color: var(--warning-ink); }
.tone-rose { background: var(--danger-soft); color: var(--danger-ink); }
.stat-badge {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: .04em;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--line);
  padding: 3px 8px;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}
.stat-badge.tone-emerald { background: var(--success-soft); color: var(--success-ink); border-color: transparent; }
.stat-value { position: relative; font-size: 33px; font-weight: 660; letter-spacing: -.04em; line-height: 1.05; font-variant-numeric: tabular-nums; margin-bottom: 5px; }
.stat-label { position: relative; font-size: 11.5px; color: var(--muted); }

.overview-grid { display: grid; grid-template-columns: 1.1fr .9fr; gap: 18px; margin-bottom: 18px; }
.panel {
  min-width: 0;
  padding: 22px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow-xs), var(--hairline);
}
.panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.panel-head h3 { font-size: 14px; font-weight: 640; letter-spacing: -.012em; margin: 0 0 3px; }
.panel-head p { font-size: 11px; color: var(--faint); margin: 0; line-height: 1.5; }
.soft-pill {
  padding: 4px 9px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--panel-inset);
  color: var(--muted);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.soft-ok { background: var(--success-soft); border-color: transparent; color: var(--success-ink); }
.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
  border: 0;
  background: none;
  color: var(--accent-text);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.link-btn .icon { width: 13px; height: 13px; transition: transform .16s ease; }
.link-btn:hover .icon { transform: translateX(2px); }
.link-btn:focus-visible { outline: none; box-shadow: var(--ring); border-radius: 4px; }

.bar-list, .region-list { display: flex; flex-direction: column; gap: 15px; }
.bar-row { display: grid; grid-template-columns: 106px minmax(0, 1fr) 52px; align-items: center; gap: 12px; }
.bar-label { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 11.5px; color: var(--text-2); }
.bar-label b { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.type-dot { width: 7px; height: 7px; border-radius: 2px; flex: none; background: var(--accent); }
.bar-track { height: 7px; border-radius: 999px; background: var(--panel-inset); overflow: hidden; box-shadow: inset 0 1px 1px rgba(16, 24, 40, .03); }
.bar-fill { display: block; height: 100%; border-radius: 999px; min-width: 2px; background: linear-gradient(90deg, #6366f1, #818cf8); transition: width .6s cubic-bezier(.2, .8, .2, 1); }
/* 0% 时不再保留 2px 的视觉残留：宽度由 JS 通过 CSSOM 写入，
   属性序列化成 "width: 0%"（冒号后带空格），旧的选择器匹配不到 */
.bar-fill.is-zero { min-width: 0; }
.bar-count { text-align: right; font-family: var(--mono); font-size: 10.5px; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.fill-vless { background: linear-gradient(90deg, #4f46e5, #818cf8); }
.fill-hysteria2 { background: linear-gradient(90deg, #db2777, #f472b6); }
.fill-trojan { background: linear-gradient(90deg, #d97706, #fbbf24); }
.fill-vmess { background: linear-gradient(90deg, #0891b2, #22d3ee); }
.fill-ss { background: linear-gradient(90deg, #059669, #34d399); }
.fill-us { background: linear-gradient(90deg, #4f46e5, #818cf8); }
.fill-jp { background: linear-gradient(90deg, #db2777, #f472b6); }
.fill-hk { background: linear-gradient(90deg, #0891b2, #22d3ee); }
.fill-relay { background: linear-gradient(90deg, #d97706, #fbbf24); }
.fill-other { background: linear-gradient(90deg, #64748b, #94a3b8); }
.bar-empty { padding: 22px 0 8px; font-size: 12px; color: var(--faint); text-align: center; }

.kv-list { list-style: none; margin: 0; padding: 0; }
.kv-list li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 0; border-bottom: 1px dashed var(--line); font-size: 12px; }
.kv-list li:last-child { border-bottom: 0; padding-bottom: 0; }
.kv-key { display: flex; align-items: center; gap: 8px; color: var(--muted); }
.kv-key .icon { width: 14px; height: 14px; color: var(--faint); }
.kv-val { display: inline-flex; align-items: center; gap: 6px; color: var(--text-2); font-weight: 600; text-align: right; }
.kv-val.is-ok { color: var(--success-ink); }
.kv-val.is-warning { color: var(--warning-ink); }
.kv-val.mono { font-family: var(--mono); font-size: 11px; }
/* 说明性提示，不是告警：用中性底 + 左侧强调线，避免和真正的风险提示抢注意力 */
.panel-note {
  margin-top: 14px;
  padding: 9px 12px;
  border-radius: var(--r-2);
  border-left: 2px solid color-mix(in srgb, var(--accent) 42%, transparent);
  background: var(--panel-inset);
  color: var(--muted);
  font-size: 11px;
  line-height: 1.65;
}
.panel-note code { font-family: var(--mono); font-size: 10.5px; color: var(--text-2); }

.mini-list { display: flex; flex-direction: column; }
.mini-item {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 10px;
  margin: 0 -10px;
  width: calc(100% + 20px);
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
}
button.mini-item { cursor: pointer; transition: background .14s ease, border-radius .14s ease; }
button.mini-item:hover { background: var(--panel-soft); border-radius: var(--r-2); }
button.mini-item:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--accent); border-radius: var(--r-2); }
.mini-item:last-child { border-bottom: 0; }
.mini-avatar { width: 30px; height: 30px; border-radius: var(--r-2); display: grid; place-items: center; font-size: 14px; background: var(--panel-inset); flex: none; }
.mini-main { flex: 1; min-width: 0; }
.mini-name { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mini-name > span:first-child { overflow: hidden; text-overflow: ellipsis; }
.mini-sub { display: block; margin-top: 1px; font-family: var(--mono); font-size: 10px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mini-item .type-badge { flex: none; }

/* ---------- 6. nodes ---------- */

.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px; margin-bottom: 14px; }
.search-box { position: relative; flex: 1 1 280px; min-width: 200px; display: flex; align-items: center; }
.search-box > .icon { position: absolute; left: 11px; width: 15px; height: 15px; color: var(--faint); pointer-events: none; }
.search-box input {
  height: 38px;
  padding-left: 34px;
  padding-right: 38px;
  border-color: transparent;
  border-radius: var(--r-2);
  background: var(--panel-inset);
  font-size: 12.5px;
}
.search-box input:hover { border-color: var(--line-2); }
.search-box input:focus { background: var(--panel); border-color: var(--accent); }
.search-box kbd {
  position: absolute;
  right: 9px;
  top: 50%;
  transform: translateY(-50%);
  padding: 1px 5px;
  border: 1px solid var(--line-2);
  border-radius: 5px;
  background: var(--panel);
  color: var(--faint);
  font-size: 9.5px;
  pointer-events: none;
}
.toolbar-filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.toolbar-filters .select-wrap select {
  height: 38px;
  padding-left: 11px;
  border-color: transparent;
  border-radius: var(--r-2);
  background: var(--panel-inset);
  font-size: 12px;
  color: var(--text-2);
}
.toolbar-filters .select-wrap select:hover { border-color: var(--line-2); }
.toolbar-filters .select-wrap select:focus { background: var(--panel); border-color: var(--accent); }
.toolbar-count { margin-left: auto; padding-right: 4px; font-size: 11px; color: var(--faint); white-space: nowrap; font-variant-numeric: tabular-nums; }

.table-panel { padding: 0; overflow: hidden; overflow: clip; }

.node-head,
.node-row {
  display: grid;
  grid-template-columns: 30px minmax(200px, 1.55fr) minmax(150px, 1.15fr) 94px 92px 64px 150px;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
}
.node-head {
  position: sticky;
  top: var(--topbar-h);
  z-index: 4;
  height: 44px;
  border-bottom: 1px solid var(--line);
  background: var(--panel-soft);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .01em;
  color: var(--faint);
}
.node-row {
  min-height: 66px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
  cursor: pointer;
  transition: background .14s ease, box-shadow .14s ease;
}
.node-row:last-child { border-bottom: 0; }
.node-row:hover { background: var(--panel-soft); }
.node-row.is-selected { background: color-mix(in srgb, var(--accent-soft) 66%, var(--panel)); box-shadow: inset 2px 0 0 var(--accent); }
.node-row.is-selected:hover { background: var(--accent-soft); }
.node-row:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--accent); background: var(--panel-soft); }
.node-row.is-disabled .cell-node,
.node-row.is-disabled .cell-server,
.node-row.is-disabled .cell-type,
.node-row.is-disabled .cell-region { opacity: .5; }
.cell { display: flex; align-items: center; min-width: 0; }
.cell-check { justify-content: flex-start; }

.check-input {
  appearance: none;
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid var(--line-3);
  border-radius: 4.5px;
  background: var(--panel);
  cursor: pointer;
  position: relative;
  flex: none;
  transition: border-color .14s ease, background .14s ease, box-shadow .14s ease;
}
.check-input:hover { border-color: var(--accent); }
.check-input:checked, .check-input:indeterminate { background: var(--accent); border-color: var(--accent); }
.check-input:checked::after {
  content: "";
  position: absolute;
  left: 4.5px;
  top: 1.5px;
  width: 4px;
  height: 8px;
  border: solid #fff;
  border-width: 0 1.8px 1.8px 0;
  transform: rotate(45deg);
}
.check-input:indeterminate::after {
  content: "";
  position: absolute;
  left: 3px;
  top: 6px;
  width: 8px;
  height: 2px;
  border-radius: 1px;
  background: #fff;
}
.check-input:focus-visible { outline: none; box-shadow: var(--ring); }

.cell-node { gap: 11px; }
.node-avatar {
  width: 36px;
  height: 36px;
  border-radius: var(--r-3);
  display: grid;
  place-items: center;
  font-size: 16px;
  flex: none;
  border: 1px solid transparent;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .6);
}
.avatar-us { background: rgba(99, 102, 241, .10); border-color: rgba(99, 102, 241, .16); }
.avatar-jp { background: rgba(219, 39, 119, .09); border-color: rgba(219, 39, 119, .15); }
.avatar-hk { background: rgba(14, 165, 233, .09); border-color: rgba(14, 165, 233, .15); }
.avatar-relay { background: rgba(217, 119, 6, .09); border-color: rgba(217, 119, 6, .15); }
.avatar-other { background: var(--panel-inset); border-color: var(--line); }
html[data-theme="dark"] .node-avatar { box-shadow: inset 0 1px 0 rgba(255, 255, 255, .05); }
.node-main { min-width: 0; }
.node-name {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -.008em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.node-name > span:first-child { overflow: hidden; text-overflow: ellipsis; }
.mini-badge {
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--warning-soft);
  border: 1px solid color-mix(in srgb, var(--warning) 22%, transparent);
  color: var(--warning-ink);
  font-size: 9px;
  font-weight: 600;
}
.node-sub { display: flex; align-items: center; gap: 3px; height: 16px; margin-top: 2px; }
.app-chip {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--panel-inset);
  border: 1px solid var(--line);
  font-size: 9.5px;
  line-height: 1.35;
}

.cell-server { gap: 0; }
.cell-server code {
  max-width: 100%;
  padding: 4px 7px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--panel-inset);
  color: var(--text-2);
  font-family: var(--mono);
  font-size: 10.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cell-server .port { margin-left: 4px; font-family: var(--mono); font-size: 10px; color: var(--faint); font-variant-numeric: tabular-nums; }

.cell-type { padding-right: 4px; }
.type-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 21px;
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: var(--r-1);
  background: var(--panel-inset);
  color: var(--text-2);
  font-size: 9.5px;
  font-weight: 650;
  letter-spacing: .015em;
  white-space: nowrap;
}
.type-badge .dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.t-vless { color: #4338ca; background: #eef2ff; border-color: #dfe5ff; }
.t-hysteria2 { color: #be185d; background: #fdf2f8; border-color: #fbe4f1; }
.t-trojan { color: #b45309; background: #fffbeb; border-color: #fdf0c9; }
.t-vmess { color: #0e7490; background: #ecfeff; border-color: #cbf5fb; }
.t-ss { color: #047857; background: #ecfdf5; border-color: #cef6e3; }
html[data-theme="dark"] .t-vless { color: #c7d2fe; background: rgba(99, 102, 241, .16); border-color: rgba(99, 102, 241, .26); }
html[data-theme="dark"] .t-hysteria2 { color: #f9a8d4; background: rgba(219, 39, 119, .15); border-color: rgba(219, 39, 119, .26); }
html[data-theme="dark"] .t-trojan { color: #fcd34d; background: rgba(217, 119, 6, .15); border-color: rgba(217, 119, 6, .26); }
html[data-theme="dark"] .t-vmess { color: #a5f3fc; background: rgba(8, 145, 178, .15); border-color: rgba(8, 145, 178, .26); }
html[data-theme="dark"] .t-ss { color: #6ee7b7; background: rgba(5, 150, 105, .15); border-color: rgba(5, 150, 105, .26); }

.region-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--panel-inset);
  color: var(--muted);
  font-size: 10px;
  white-space: nowrap;
}
.cell-status { justify-content: flex-start; }
.cell-actions { justify-content: flex-end; gap: 1px; opacity: .68; transition: opacity .15s ease; }
.node-row:hover .cell-actions,
.node-row:focus-within .cell-actions { opacity: 1; }
.cell-actions .icon-btn { width: 28px; height: 28px; }
.cell-actions .icon-btn .icon { width: 14px; height: 14px; }
.cell-actions .move-btn { color: var(--faint); }

.empty { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 60px 24px 68px; }
.empty-art { color: var(--faint); margin-bottom: 14px; opacity: .9; }
.empty-art svg { width: 120px; height: 90px; }
.empty h3 { font-size: 15px; font-weight: 640; margin: 0 0 5px; }
.empty p { font-size: 12px; color: var(--muted); margin: 0 0 18px; }
.empty-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: center; }

/* ---------- 7. preview ---------- */

.sub-strip { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 18px; margin-bottom: 14px; }
.sub-strip-info { display: flex; align-items: center; gap: 12px; min-width: 0; }
.sub-strip-info .stat-icon { width: 34px; height: 34px; }
.sub-strip-info > div { display: flex; flex-direction: column; min-width: 0; }
.sub-strip-info strong { font-size: 10px; font-weight: 650; letter-spacing: .06em; color: var(--muted); margin-bottom: 2px; text-transform: uppercase; }
.sub-strip-info span { font-family: var(--mono); font-size: 10.5px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.code-panel {
  padding: 0;
  overflow: hidden;
  background: #0a0f1c;
  border-color: rgba(148, 163, 184, .16);
  box-shadow: var(--shadow-md);
}
html[data-theme="dark"] .code-panel {
  background: #0b1220;
  border-color: rgba(148, 163, 184, .18);
  box-shadow: 0 24px 60px -34px rgba(0, 0, 0, .8);
}
.code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 48px;
  padding: 0 16px;
  background: linear-gradient(180deg, #0e1727, #0b1220);
  border-bottom: 1px solid rgba(148, 163, 184, .1);
}
.code-file { display: flex; align-items: center; gap: 10px; min-width: 0; color: #cbd5e1; font-size: 11px; }
.file-dots { display: inline-flex; gap: 5px; margin-right: 4px; }
.file-dots i { width: 8px; height: 8px; border-radius: 50%; background: #334155; }
.file-dots i:nth-child(1) { background: #f87171; opacity: .62; }
.file-dots i:nth-child(2) { background: #fbbf24; opacity: .62; }
.file-dots i:nth-child(3) { background: #34d399; opacity: .62; }
.code-badge {
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(59, 130, 246, .24);
  background: rgba(59, 130, 246, .13);
  color: #93c5fd;
  font-size: 8.5px;
  font-weight: 650;
  letter-spacing: .09em;
}
.code-meta { display: flex; align-items: center; gap: 8px; color: #64748b; font-family: var(--mono); font-size: 10px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.dot-sep { width: 3px; height: 3px; border-radius: 50%; background: #334155; }
.code-body { position: relative; min-height: 340px; max-height: calc(100vh - 316px); overflow: auto; }
.code { margin: 0; padding: 14px 0 26px; color: #a9b7d0; font-size: 11.5px; line-height: 1.72; tab-size: 2; }
.code-line { display: flex; min-width: max-content; padding-right: 24px; }
.code-line:hover { background: rgba(148, 163, 184, .045); }
.ln {
  flex: none;
  width: 54px;
  padding-right: 16px;
  text-align: right;
  color: #3b4761;
  user-select: none;
  font-variant-numeric: tabular-nums;
}
.lc { flex: 1; white-space: pre; }
.tok-comment { color: #55637d; font-style: italic; }
.tok-key { color: #8ab4f8; }
.tok-string { color: #86efac; }
.tok-number { color: #fbbf24; }
.tok-bool { color: #f0abfc; }
.code-body::-webkit-scrollbar-thumb { background: #243049; background-clip: content-box; }
.code-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(10, 15, 28, .76);
  color: #94a3b8;
  font-size: 11.5px;
  backdrop-filter: blur(2px);
}
.code-loading .spinner { width: 15px; height: 15px; }

/* ---------- 8. drawer ---------- */

.drawer-layer { position: fixed; inset: 0; z-index: 100; }
.drawer-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(8, 13, 23, .52);
  backdrop-filter: blur(3px);
  opacity: 0;
  transition: opacity .25s ease;
}
.drawer-layer.is-open .drawer-backdrop { opacity: 1; }
.drawer {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  width: min(580px, 100%);
  height: 100%;
  background: var(--panel);
  border-left: 1px solid var(--line);
  box-shadow: -30px 0 80px -40px rgba(0, 0, 0, .5);
  transform: translateX(28px);
  opacity: 0;
  transition: transform .32s cubic-bezier(.22, .8, .26, 1), opacity .2s ease;
}
.drawer-layer.is-open .drawer { transform: none; opacity: 1; }
.drawer-head {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 18px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, var(--panel-soft), var(--panel));
}
.drawer-title-wrap { display: flex; align-items: center; gap: 12px; min-width: 0; }
.drawer-icon {
  width: 38px;
  height: 38px;
  border-radius: var(--r-3);
  background: var(--accent-soft);
  color: var(--accent-text);
  display: grid;
  place-items: center;
  flex: none;
}
.drawer-icon .icon { width: 18px; height: 18px; }
.drawer-head h2 { font-size: 16px; font-weight: 650; letter-spacing: -.018em; margin: 0 0 2px; }
.drawer-head p { font-size: 11px; color: var(--faint); }
.drawer form { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.drawer-body { flex: 1; overflow-y: auto; padding: 4px 24px 20px; }
.form-section { padding: 18px 0; border-bottom: 1px solid var(--line); }
.form-section:last-of-type { border-bottom: 0; }
.section-head { margin-bottom: 14px; }
.section-head h3 { font-size: 13px; font-weight: 650; letter-spacing: -.012em; margin: 0 0 3px; }
.section-head p { font-size: 11px; color: var(--faint); line-height: 1.55; }

.type-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
.type-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 11px 4px 9px;
  border: 1px solid var(--line);
  border-radius: var(--r-3);
  background: var(--panel-soft);
  color: var(--muted);
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color .16s ease, background .16s ease, color .16s ease, box-shadow .16s ease;
}
.type-card:hover { border-color: var(--line-3); color: var(--text-2); background: var(--panel); }
.type-card:focus-visible { outline: none; box-shadow: var(--ring); }
.type-card.is-active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-text); box-shadow: 0 0 0 3px var(--accent-soft); }
.type-mark {
  padding: 3px 6px;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-radius: 5px;
  background: color-mix(in srgb, currentColor 9%, transparent);
  font-family: var(--mono);
  font-size: 9px;
  font-weight: 700;
}
.segmented {
  display: inline-flex;
  width: 100%;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: var(--r-3);
  background: var(--panel-inset);
}
.segmented button {
  flex: 1;
  height: 32px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background .16s ease, color .16s ease, box-shadow .16s ease;
}
.segmented button:hover { color: var(--text-2); }
.segmented button:focus-visible { outline: none; box-shadow: var(--ring); }
.segmented button.is-active { background: var(--panel); color: var(--text); box-shadow: var(--shadow-xs), 0 0 0 1px var(--line); }
.switch-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 11px 0; margin-top: 4px; border-top: 1px dashed var(--line); }
.switch-row-last { padding: 0; border-top: 0; }
.switch-copy b { display: block; margin-bottom: 2px; font-size: 12px; font-weight: 600; color: var(--text-2); }
.switch-copy small { display: block; font-size: 10.5px; line-height: 1.55; color: var(--faint); }
.chip-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tag-chip {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-3);
  background: var(--panel-soft);
  color: var(--muted);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  transition: border-color .16s ease, background .16s ease, color .16s ease;
}
.tag-chip:hover { border-color: var(--line-3); }
.tag-chip.is-on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-text); }
.tag-chip input { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }
.tag-chip:has(input:focus-visible) { box-shadow: var(--ring); }
.drawer-foot {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 24px;
  border-top: 1px solid var(--line);
  background: var(--panel-soft);
}
.kbd-hint { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--faint); }
.kbd-hint span { margin: 0 2px; color: var(--line-3); }
kbd {
  display: inline-block;
  padding: 1px 5px;
  border: 1px solid var(--line-2);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--panel);
  color: var(--muted);
  font-size: 9px;
}
.drawer-foot-actions { display: flex; gap: 8px; }

/* ---------- 9. modal & toast ---------- */

.modal-layer { position: fixed; inset: 0; z-index: 120; display: flex; align-items: center; justify-content: center; padding: 20px; }
.modal-backdrop { position: absolute; inset: 0; background: rgba(8, 13, 23, .55); backdrop-filter: blur(3px); opacity: 0; transition: opacity .2s ease; }
.modal-layer.is-open .modal-backdrop { opacity: 1; }
.modal {
  position: relative;
  width: min(420px, 100%);
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 24px;
  border: 1px solid var(--line);
  border-radius: var(--r-6);
  background: var(--panel);
  box-shadow: var(--shadow-lg), 0 0 0 1px rgba(16, 24, 40, .03);
  transform: translateY(8px) scale(.985);
  opacity: 0;
  transition: transform .24s cubic-bezier(.2, .8, .2, 1), opacity .18s ease;
}
.modal-layer.is-open .modal { transform: none; opacity: 1; }
.modal-wide { width: min(560px, 100%); }
.modal-icon { width: 42px; height: 42px; border-radius: var(--r-4); display: grid; place-items: center; margin-bottom: 16px; }
.modal-icon .icon { width: 19px; height: 19px; }
.modal h2 { font-size: 17px; font-weight: 650; letter-spacing: -.022em; margin: 0 0 8px; }
.modal p { font-size: 12px; line-height: 1.68; color: var(--muted); margin: 0 0 18px; }
.modal p strong { color: var(--text); font-weight: 600; }
.modal-sub { margin-bottom: 18px !important; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.steps { list-style: none; margin: 0 0 16px; padding: 0; display: flex; flex-direction: column; gap: 14px; }
.steps li { display: flex; gap: 12px; }
.step-no {
  width: 24px;
  height: 24px;
  border-radius: var(--r-2);
  background: var(--accent-soft);
  color: var(--accent-text);
  display: grid;
  place-items: center;
  font-size: 10.5px;
  font-weight: 700;
  flex: none;
  margin-top: 1px;
}
.steps b { display: block; margin-bottom: 2px; font-size: 12px; font-weight: 600; color: var(--text-2); }
.steps p { margin: 0; font-size: 11px; line-height: 1.62; color: var(--muted); }
.modal code, .auth-help code { padding: 1px 5px; border: 1px solid var(--line); border-radius: 4px; background: var(--panel-inset); color: var(--text-2); font-family: var(--mono); font-size: 10px; }
.modal-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  background: var(--panel-inset);
  color: var(--muted);
  font-size: 11px;
  line-height: 1.62;
}
.modal-note .icon { width: 14px; height: 14px; flex: none; margin-top: 1px; color: var(--faint); }

.toast-stack { position: fixed; right: 24px; bottom: 24px; z-index: 200; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
.toast {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  min-width: 240px;
  max-width: 380px;
  padding: 11px 14px;
  border: 1px solid rgba(148, 163, 184, .18);
  border-radius: var(--r-4);
  background: var(--ink-800);
  color: #e2e8f0;
  font-size: 12px;
  line-height: 1.55;
  box-shadow: 0 18px 44px -18px rgba(0, 0, 0, .55);
  opacity: 0;
  transform: translateY(8px);
  transition: opacity .2s ease, transform .2s ease;
  pointer-events: auto;
}
.toast.is-show { opacity: 1; transform: none; }
.toast .icon { width: 15px; height: 15px; flex: none; margin-top: 1px; color: #94a3b8; }
.toast-success { border-color: rgba(52, 211, 153, .24); }
.toast-success .icon { color: #34d399; }
.toast-error { border-color: rgba(251, 113, 133, .26); }
.toast-error .icon { color: #fb7185; }
.toast-info .icon { color: #60a5fa; }

/* ---------- 10. responsive ---------- */

@media (max-width: 1180px) {
  .hero { grid-template-columns: 1fr; }
  .hero-visual { display: none; }
  .stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .overview-grid { grid-template-columns: 1fr; }
  .page-head { flex-direction: column; align-items: stretch; gap: 14px; }
  .page-actions { width: 100%; padding-top: 0; }
  .page-head-meta { flex-direction: row; align-items: center; gap: 10px; padding-top: 0; }
}

@media (max-width: 1120px) {
  .node-head { display: none; }
  .table-panel { padding: 0; background: transparent; border: 0; box-shadow: none; overflow: visible; }
  .node-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .node-row {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto auto;
    grid-template-areas:
      "check node node status"
      "check server server server"
      "check type region actions";
    align-items: center;
    gap: 10px 10px;
    min-height: 0;
    padding: 13px;
    border: 1px solid var(--line);
    border-radius: var(--r-5);
    background: var(--panel);
    box-shadow: var(--shadow-xs), var(--hairline);
  }
  .cell-actions .icon-btn { width: 26px; height: 26px; }
  .node-row:hover { background: var(--panel); border-color: var(--line-2); box-shadow: var(--shadow-sm), var(--hairline); }
  .node-row:last-child { border-bottom: 1px solid var(--line); }
  .node-row.is-selected { box-shadow: inset 2px 0 0 var(--accent), var(--shadow-xs); }
  .cell-check { grid-area: check; align-self: start; padding-top: 9px; }
  .cell-node { grid-area: node; }
  .cell-server { grid-area: server; padding: 7px 10px; border: 1px solid var(--line); border-radius: var(--r-2); background: var(--panel-inset); }
  .cell-server code { padding: 0; border: 0; background: none; }
  .cell-type { grid-area: type; }
  .cell-region { grid-area: region; justify-self: start; }
  .cell-status { grid-area: status; justify-self: end; }
  .cell-actions { grid-area: actions; justify-self: end; opacity: 1; }
  .node-avatar { width: 34px; height: 34px; }
}

@media (max-width: 960px) {
  .app { display: block; }
  .sidebar {
    position: sticky;
    top: 0;
    width: 100%;
    height: auto;
    min-height: 0;
    flex-direction: row;
    align-items: center;
    gap: 12px;
    padding: 9px 14px;
    border-right: 0;
    border-bottom: 1px solid var(--side-line);
    overflow: visible;
  }
  .sidebar::before { height: 100%; width: 280px; }
  .side-head { flex: none; padding: 0; gap: 8px; }
  .logo-tile, .logo-tile .icon { width: 30px; height: 30px; }
  .logo-copy strong { font-size: 13px; }
  .logo-copy span { display: none; }
  .side-nav { flex-direction: row; gap: 2px; margin-left: auto; }
  .nav-caption { display: none; }
  .nav-item { width: auto; height: 36px; padding: 0 11px; gap: 6px; font-size: 12px; border-radius: var(--r-2); }
  .nav-item .icon { width: 16px; height: 16px; }
  .nav-item.is-active::before { display: none; }
  .nav-badge { display: none; }
  .side-foot { display: none; }
  .mobile-action { display: grid; width: 32px; height: 32px; color: var(--side-text); }
  .mobile-action:hover { background: var(--side-hover); color: var(--side-text-strong); }
  .topbar { display: none; }
  .content { padding: 22px 18px 60px; }
  .page-head { flex-direction: column; align-items: stretch; gap: 14px; }
  .page-head h1 { font-size: 23px; }
  .page-head-meta { display: none; }
  .page-actions { width: 100%; padding-top: 0; }
  .page-actions .btn { flex: 1; }
  .hero { padding: 24px 20px; border-radius: var(--r-6); }
  .hero h2 { font-size: 24px; }
  .sub-card-head span:last-child { display: none; }
  .toolbar { padding: 10px; }
  .toolbar-count { width: 100%; margin-left: 0; padding-right: 0; text-align: right; }
  .sub-strip { padding: 12px 14px; }
  .sub-strip-info .stat-icon { display: none; }
  .sub-strip .btn { flex: none; }
  .drawer { width: 100%; }
  .code-body { max-height: 65vh; }
  .node-head { position: static; }
}

@media (max-width: 760px) {
  .node-list { grid-template-columns: 1fr; }
  .stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .stat-card { padding: 15px 16px 14px; }
  .stat-value { font-size: 26px; }
  .panel { padding: 16px; }
  .page-actions .btn { padding: 0 10px; font-size: 12px; }
  .page-actions .btn .icon { width: 14px; height: 14px; }
  .toolbar-filters { width: 100%; }
  .toolbar-filters .select-wrap { flex: 1; }
  .toolbar-filters .select-wrap select { width: 100%; }
  .search-box { flex: 1 1 100%; }
  .alert { flex-wrap: wrap; align-items: flex-start; }
  .alert .btn { margin-left: 44px; }
  .sub-strip-info { flex: 1; }
  .sub-strip-info span { max-width: 56vw; }
  .code-meta { display: none; }
  .drawer-foot { padding: 12px 16px; }
  .drawer-body { padding: 4px 16px 16px; }
  .drawer-head { padding: 16px; }
  .kbd-hint { display: none; }
  .drawer-foot-actions { width: 100%; }
  .drawer-foot-actions .btn { flex: 1; }
  .toast-stack { left: 16px; right: 16px; bottom: 16px; }
  .toast { min-width: 0; max-width: none; width: 100%; }
}

@media (max-width: 640px) {
  .side-head .logo-copy { display: none; }
  .sidebar { gap: 8px; }
  .auth-screen { padding: 16px; justify-content: flex-start; }
  .auth-shell { grid-template-columns: 1fr; min-height: 0; margin: auto 0; border-radius: var(--r-6); }
  .auth-story { min-height: 78px; padding: 20px 22px; flex-direction: row; align-items: center; justify-content: space-between; }
  .auth-story-copy, .auth-story-foot { display: none; }
  .auth-story-art { opacity: .5; }
  .auth-panel { padding: 30px 22px 28px; }
  .auth-form-head h2 { font-size: 22px; }
  .auth-footer { margin-top: 14px; }
  .hero h2 { font-size: 22px; }
  .hero-actions .btn { flex: 1; }
  .hero-actions { gap: 8px; }
  .type-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .chip-grid { grid-template-columns: 1fr; }
  .bar-row { grid-template-columns: 100px minmax(0, 1fr) 46px; gap: 9px; }
  .sub-strip { flex-direction: column; align-items: stretch; }
  .sub-strip .btn { width: 100%; }
  .sub-strip-info span { max-width: none; }
  .page-actions { flex-wrap: wrap; }
  .page-actions .btn { flex: 1 1 calc(50% - 4px); }
  .page-actions #preview-copy { flex-basis: 100%; }
  .modal { padding: 20px; border-radius: var(--r-5); }
  .modal-actions .btn { flex: 1; }
  .alert .btn { margin-left: 0; width: 100%; }
  .step-no { width: 22px; height: 22px; }
  .nav-item .nav-text { display: none; }
  .nav-item { width: 36px; padding: 0; justify-content: center; }
}

@media (max-width: 480px) {
  .field-row, .field-row:has(.field-port) { grid-template-columns: 1fr; }
  .field-port { max-width: none; }
  .hero { padding: 22px 16px; }
  .hero-version { display: none; }
  .sub-input code { font-size: 10px; }
  .section-head p { display: none; }
  .type-grid { gap: 6px; }
  .type-card { padding: 9px 2px 8px; font-size: 9.5px; }
  .stat-grid { gap: 8px; }
  .stat-card { padding: 13px 14px 12px; }
  .stat-icon { width: 30px; height: 30px; }
  .stat-value { font-size: 24px; }
  .panel-head { flex-wrap: wrap; }
  .code-head { padding: 0 12px; }
  .code { font-size: 10.5px; }
  .ln { width: 42px; padding-right: 12px; }
  .toolbar-filters .btn { display: none; }
  .modal { max-height: calc(100vh - 24px); }
  .modal-layer { padding: 12px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
  }
}

/* ---------- 11. bulk bar ---------- */

.bulk-bar {
  position: fixed;
  z-index: 70;
  left: calc(var(--sidebar-w) + 28px);
  right: 28px;
  bottom: 20px;
  width: min(900px, calc(100vw - var(--sidebar-w) - 56px));
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 54px;
  padding: 9px 10px 9px 16px;
  border: 1px solid rgba(148, 163, 184, .18);
  border-radius: var(--r-5);
  background: var(--ink-800);
  color: #e2e8f0;
  box-shadow: 0 26px 64px -26px rgba(8, 13, 23, .7), inset 0 1px 0 rgba(255, 255, 255, .05);
  animation: bulk-in .24s cubic-bezier(.2, .8, .2, 1);
}
@keyframes bulk-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}
.bulk-bar.is-busy { opacity: .72; pointer-events: none; }
.bulk-count { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
.bulk-count b { font-size: 16px; font-weight: 650; color: #f8fafc; font-variant-numeric: tabular-nums; }
.bulk-count span { font-size: 11px; color: #94a3b8; }
.bulk-divider { width: 1px; height: 22px; background: rgba(148, 163, 184, .18); flex: none; }
.bulk-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.bulk-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid rgba(148, 163, 184, .18);
  border-radius: var(--r-2);
  background: rgba(255, 255, 255, .04);
  color: #cbd5e1;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background .14s ease, border-color .14s ease, color .14s ease;
}
.bulk-btn:hover { background: rgba(255, 255, 255, .09); border-color: rgba(148, 163, 184, .3); color: #f1f5f9; }
.bulk-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(129, 140, 248, .6); }
.bulk-btn .icon { width: 13px; height: 13px; }
.bulk-btn.is-danger { color: #fda4af; }
.bulk-btn.is-danger:hover { background: rgba(244, 63, 94, .14); border-color: rgba(244, 63, 94, .32); color: #fecdd3; }
.bulk-btn:disabled { opacity: .45; cursor: not-allowed; }
.bulk-select { flex: none; }
.bulk-select select {
  width: 152px;
  height: 32px;
  padding: 0 26px 0 10px;
  border-color: rgba(148, 163, 184, .18);
  border-radius: var(--r-2);
  background: var(--ink-750);
  color: #cbd5e1;
  font-size: 11.5px;
}
.bulk-select select:hover { border-color: rgba(148, 163, 184, .3); }
.bulk-select > .icon { color: #64748b; }
.bulk-close { margin-left: auto; color: #94a3b8; }
.bulk-close:hover { background: rgba(255, 255, 255, .08); color: #f1f5f9; }
body.has-bulk .toast-stack { bottom: 96px; }
body.has-bulk .content { padding-bottom: 158px; }

/* ---------- 12. row menu ---------- */

.row-menu {
  position: fixed;
  z-index: 90;
  min-width: 182px;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-4);
  background: var(--panel);
  box-shadow: var(--shadow-md), 0 0 0 1px rgba(16, 24, 40, .02);
  opacity: 0;
  transform: translateY(-4px) scale(.985);
  transform-origin: top right;
  transition: opacity .14s ease, transform .14s ease;
}
.row-menu.is-open { opacity: 1; transform: none; }
.menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--r-2);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}
.menu-item .icon { width: 14px; height: 14px; color: var(--faint); flex: none; }
.menu-item:hover, .menu-item:focus-visible { background: var(--panel-inset); color: var(--text); outline: none; }
.menu-item:hover .icon, .menu-item:focus-visible .icon { color: var(--text-2); }
.menu-item.is-danger { color: var(--danger-ink); }
.menu-item.is-danger .icon { color: currentColor; }
.menu-item.is-danger:hover, .menu-item.is-danger:focus-visible { background: var(--danger-soft); color: var(--danger-ink); }
.menu-item:disabled { opacity: .4; cursor: not-allowed; }
.menu-item:disabled:hover { background: transparent; color: var(--muted); }
.menu-sep { display: block; height: 1px; margin: 5px 8px; background: var(--line); }

/* ---------- 13. share links ---------- */

.modal-links {
  width: min(720px, 100%);
  max-height: min(88vh, 820px);
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.links-head { flex: none; display: flex; align-items: center; gap: 12px; padding: 20px 22px 16px; border-bottom: 1px solid var(--line); }
.links-head .modal-icon { margin: 0; width: 38px; height: 38px; border-radius: var(--r-3); flex: none; }
.links-title-wrap { flex: 1; min-width: 0; }
.links-title-wrap h2 { margin: 0 0 2px; font-size: 16px; }
.links-title-wrap p { margin: 0; font-size: 11.5px; color: var(--muted); line-height: 1.55; }
.links-head .icon-btn { margin-left: 2px; }
.tabs { flex: none; display: flex; gap: 4px; padding: 0 22px; border-bottom: 1px solid var(--line); background: var(--panel-soft); }
.tab {
  height: 40px;
  padding: 0 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: color .14s ease, border-color .14s ease;
}
.tab:hover { color: var(--text-2); }
.tab.is-active { color: var(--accent-text); border-bottom-color: var(--accent); }
.links-body { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 22px 16px; }
.links-body .field { margin-bottom: 0; }
.textarea {
  width: 100%;
  min-height: 120px;
  padding: 10px 12px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-3);
  background: var(--panel);
  color: var(--text);
  font-size: 12px;
  line-height: 1.6;
  resize: vertical;
  transition: border-color .16s ease, box-shadow .16s ease;
}
.textarea:hover { border-color: var(--line-3); }
.textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.links-input { min-height: 132px; font-family: var(--mono); font-size: 11px; line-height: 1.65; white-space: pre; overflow-x: auto; }
.links-options { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin: 12px 0 0; }
.inline-field { display: flex; align-items: center; gap: 8px; min-width: 0; }
.inline-field > label { font-size: 11px; font-weight: 600; color: var(--text-2); white-space: nowrap; }
.inline-field select { width: auto; min-width: 138px; height: 34px; padding: 0 30px 0 10px; font-size: 11.5px; }
.links-feedback {
  margin-top: 12px;
  padding: 11px 12px;
  border: 1px solid color-mix(in srgb, var(--warning) 26%, transparent);
  border-radius: var(--r-3);
  background: var(--warning-soft);
  color: var(--text-2);
  font-size: 11px;
  line-height: 1.6;
}
.links-feedback p { margin: 0; }
.links-feedback-head { display: flex; align-items: center; gap: 7px; color: var(--warning-ink); font-size: 11.5px; }
.links-feedback-head .icon { width: 13px; height: 13px; }
.links-error-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.links-error-list li { display: flex; align-items: baseline; gap: 8px; }
.links-error-list li span { flex: none; font-family: var(--mono); font-size: 9.5px; color: var(--faint); }
.links-error-more { margin: 6px 0 0; font-size: 10.5px; color: var(--faint); }
.links-overflow { display: flex; gap: 6px; margin: 8px 0 0 !important; color: var(--danger-ink); font-size: 11px; }
.links-overflow .icon { width: 13px; height: 13px; flex: none; margin-top: 1px; }
.links-preview { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
.link-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--r-3);
  background: var(--panel-soft);
  transition: border-color .14s ease, background .14s ease;
}
.link-item:hover { border-color: var(--line-2); background: var(--panel); }
.link-kind { flex: none; min-width: 42px; padding: 3px 5px; border-radius: 5px; font-family: var(--mono); font-size: 8.5px; font-weight: 700; letter-spacing: .02em; text-align: center; }
.link-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.link-name { font-size: 11.5px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.link-meta { font-family: var(--mono); font-size: 9.5px; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.link-region { flex: none; padding: 2px 7px; border: 1px solid var(--line); border-radius: 999px; background: var(--panel); font-size: 9.5px; color: var(--muted); }
.link-remove { width: 26px; height: 26px; flex: none; }
.link-remove .icon { width: 13px; height: 13px; }
.links-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 26px 16px;
  border: 1px dashed var(--line-2);
  border-radius: var(--r-3);
  text-align: center;
  color: var(--faint);
  background: var(--panel-soft);
}
.links-empty-icon { width: 34px; height: 34px; display: grid; place-items: center; border-radius: var(--r-3); background: var(--panel); border: 1px solid var(--line); color: var(--faint); }
.links-empty-icon .icon { width: 16px; height: 16px; }
.modal .links-empty p { margin: 0; font-size: 11.5px; }
.links-empty small { font-size: 10.5px; color: var(--faint); }
.links-export-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.modal .links-export-head p { margin: 0; font-size: 11.5px; color: var(--muted); }
.links-export {
  margin: 12px 0;
  padding: 12px 14px;
  min-height: 180px;
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: var(--r-3);
  background: var(--panel-inset);
  color: var(--text-2);
  font-family: var(--mono);
  font-size: 10.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
}
.links-export.is-empty { color: var(--faint); }
.links-export-actions { display: flex; justify-content: flex-end; gap: 8px; }
.links-foot {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 22px;
  border-top: 1px solid var(--line);
  background: var(--panel-soft);
}
.links-foot-note { font-size: 10.5px; color: var(--faint); min-width: 0; }
.links-foot-actions { display: flex; gap: 8px; flex: none; }

/* ---------- 13b. preview groups & search ---------- */

.group-strip { display: flex; align-items: center; gap: 12px; padding: 11px 16px; margin-bottom: 14px; overflow: hidden; }
.group-strip-label { display: inline-flex; align-items: center; gap: 6px; flex: none; font-size: 10px; font-weight: 650; letter-spacing: .04em; color: var(--faint); }
.group-strip-label .icon { width: 14px; height: 14px; }
.group-pills { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
.group-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 250px;
  padding: 3px 4px 3px 9px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--panel-inset);
  color: var(--text-2);
  font-size: 10.5px;
  white-space: nowrap;
}
.group-pill-name { overflow: hidden; text-overflow: ellipsis; }
.group-pill b {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: 9.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.group-pill.is-zero { opacity: .55; }
.group-pill.is-zero b { background: var(--panel); color: var(--faint); }

.code-search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 3px;
  flex: 1;
  max-width: 330px;
  height: 30px;
  padding: 0 3px 0 9px;
  border: 1px solid rgba(148, 163, 184, .16);
  border-radius: var(--r-2);
  background: rgba(148, 163, 184, .07);
  transition: border-color .14s ease, background .14s ease;
}
.code-search:focus-within { border-color: rgba(129, 140, 248, .55); background: rgba(148, 163, 184, .11); }
.code-search > .icon { width: 13px; height: 13px; color: #64748b; flex: none; }
.code-search input { flex: 1; min-width: 0; width: auto; height: auto; padding: 0; border: 0; border-radius: 0; background: transparent; color: #cbd5e1; font-size: 11px; line-height: 1.2; }
.code-search input:focus { outline: none; border: 0; box-shadow: none; }
.code-search input::placeholder { color: #5b6b84; }
.code-search-count { flex: none; padding: 0 4px; font-family: var(--mono); font-size: 9.5px; color: #94a3b8; white-space: nowrap; font-variant-numeric: tabular-nums; }
.code-search-count.is-empty { color: #fb7185; }
.code-search-btn { flex: none; width: 22px; height: 22px; display: grid; place-items: center; border: 0; border-radius: 5px; background: transparent; color: #94a3b8; cursor: pointer; transition: background .14s ease, color .14s ease; }
.code-search-btn:hover { background: rgba(148, 163, 184, .14); color: #e2e8f0; }
.code-search-btn:disabled { opacity: .32; cursor: default; }
.code-search-btn .icon { width: 12px; height: 12px; }
mark.code-hit { padding: 0 1px; margin: 0 -1px; border-radius: 3px; background: rgba(250, 204, 21, .26); color: inherit; box-shadow: inset 0 0 0 1px rgba(250, 204, 21, .32); }
mark.code-hit.is-current { background: #facc15; color: #1e293b; box-shadow: 0 0 0 2px rgba(250, 204, 21, .28); }

/* ---------- 14. settings ---------- */

/* 为悬浮保存条预留空间，避免滚到底部时遮住最后一张卡片 */
.view[data-view-panel="settings"] { padding-bottom: 76px; }

.settings-panel { max-width: 820px; margin-inline: auto; padding: 24px 26px; }
.settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; max-width: 820px; margin: 16px auto 0; }
.settings-grid .settings-panel { max-width: none; margin: 0; }
.settings-actions {
  position: sticky;
  bottom: 14px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  max-width: 820px;
  margin: 18px auto 0;
  padding: 11px 14px;
  border: 1px solid var(--line);
  border-radius: var(--r-5);
  background: color-mix(in srgb, var(--panel) 94%, transparent);
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  box-shadow: var(--shadow-sm);
}
.settings-actions-note { display: inline-flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--faint); }
.settings-actions-note .icon { width: 13px; height: 13px; }
.settings-actions-btns { display: flex; gap: 8px; margin-left: auto; }
.theme-seg { max-width: 340px; }
.appearance-note { display: flex; align-items: flex-start; gap: 7px; margin-top: 12px; font-size: 11px; line-height: 1.6; color: var(--faint); }
.appearance-note .icon { width: 14px; height: 14px; flex: none; margin-top: 1px; color: var(--accent-text); }

.toast-text { flex: 1; min-width: 0; }
.toast.has-action { align-items: center; }
.toast-action {
  flex: none;
  margin-left: 4px;
  padding: 4px 9px;
  border: 1px solid rgba(148, 163, 184, .3);
  border-radius: var(--r-1);
  background: rgba(255, 255, 255, .07);
  color: #c7d2fe;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background .14s ease, color .14s ease;
}
.toast-action:hover { background: rgba(255, 255, 255, .13); color: #e0e7ff; }

/* ---------- 15. users ---------- */

.user-list { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: var(--r-4); background: var(--panel-soft); overflow: hidden; }
.user-row { display: flex; align-items: center; gap: 12px; padding: 11px 13px; border-top: 1px solid var(--line); }
.user-row:first-child { border-top: 0; }
.user-row.is-current { background: color-mix(in srgb, var(--accent-soft) 55%, transparent); }
.user-avatar {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: var(--r-3);
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: .02em;
}
.user-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.user-name { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 12.5px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.user-badge { flex: none; padding: 1px 7px; border-radius: 999px; background: var(--accent-soft); color: var(--accent-text); font-size: 9.5px; font-weight: 650; letter-spacing: .02em; }
.user-sub { font-size: 10.5px; color: var(--faint); }
.user-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 3px 8px; }
.role-badge { flex: none; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); font-size: 9.5px; font-weight: 650; letter-spacing: .02em; }
.role-badge.is-owner { border-color: transparent; background: var(--accent-soft); color: var(--accent-text); }
.scope-all { display: inline-flex; align-items: center; gap: 6px; margin: 2px 0 8px; font-size: 12px; color: var(--text-2); cursor: pointer; }
.scope-all input { margin: 0; }
.scope-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 8px; max-height: 172px; overflow: auto; padding: 7px; border: 1px solid var(--line); border-radius: var(--r-3); background: var(--panel-soft); }
.scope-item { display: flex; align-items: center; gap: 7px; min-width: 0; padding: 5px 6px; border-radius: var(--r-2); font-size: 11.5px; color: var(--text); cursor: pointer; }
.scope-item:hover { background: var(--panel); }
.scope-item input { flex: none; margin: 0; }
.scope-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scope-meta { flex: none; font-size: 10px; color: var(--faint); }
.scope-list.is-all .scope-item { opacity: .72; }
.scope-empty { grid-column: 1 / -1; padding: 6px; font-size: 11.5px; color: var(--faint); }
.account-panel .field { margin-bottom: 12px; }
.account-panel .field-row { margin-bottom: 0; }
.account-password { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
.account-password .section-head { margin-bottom: 12px; }
.account-actions { display: flex; justify-content: flex-end; }
.account-panel .field-error:not(:empty) { display: block; margin-top: 6px; }
body.is-member .bulk-bar,
body.is-member #user-add,
body.is-member .user-actions { display: none !important; }
/* 保留复选框列位，避免宽屏表格网格整体左移一列 */
body.is-member .cell-check { visibility: hidden; }
body.is-member .node-row.is-shared { cursor: default; }
body.is-member .node-row.is-shared:hover { background: var(--panel); }
.mini-badge.is-personal { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); background: color-mix(in srgb, var(--accent-soft) 60%, transparent); }
.shared-lock { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; color: var(--faint); }
.shared-lock .icon { width: 15px; height: 15px; }
.user-actions { display: flex; align-items: center; gap: 4px; flex: none; }
.user-actions .btn { height: 30px; padding: 0 9px; font-size: 11px; }
.user-delete { width: 30px; padding: 0; justify-content: center; color: var(--faint); }
.user-delete:hover:not(:disabled) { background: var(--danger-soft); color: var(--danger-ink); }
.user-delete:disabled { opacity: .34; }
.user-delete .icon { width: 14px; height: 14px; }
.user-empty { padding: 26px 16px; text-align: center; font-size: 11.5px; line-height: 1.6; color: var(--faint); }
.user-empty.is-error { color: var(--danger-ink); }
.user-editor { margin-top: 14px; padding: 16px 16px 14px; border: 1px solid var(--line); border-radius: var(--r-4); background: var(--panel); box-shadow: var(--shadow-xs); }
.user-editor-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; margin-bottom: 12px; }
.user-editor-head b { font-size: 12.5px; font-weight: 650; color: var(--text); }
.user-editor-head span { font-size: 10.5px; color: var(--faint); line-height: 1.5; }
.user-editor .field { margin-bottom: 12px; }
.user-editor .field > label { font-size: 11px; }
.user-editor input:not([type="checkbox"]) { height: 40px; font-size: 12.5px; background: var(--panel); }
.user-editor .field-row { gap: 10px; }
.user-editor .field-row .field { margin-bottom: 0; }
.user-editor > .field-error:not(:empty) { display: block; margin-top: 8px; }
.user-editor-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.auth-link,
.auth-help .auth-link {
  display: block;
  margin-top: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-text);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.6;
  text-align: left;
  cursor: pointer;
}
.auth-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.auth-link[hidden] { display: none; }

/* ---------- responsive tail ---------- */

@media (max-width: 960px) {
  .bulk-bar { left: 16px; right: 16px; bottom: 14px; width: auto; }
  .settings-grid { grid-template-columns: 1fr; max-width: none; }
  .settings-panel { max-width: none; }
  .settings-actions { max-width: none; position: static; background: transparent; border: 0; box-shadow: none; padding: 0; backdrop-filter: none; }
  .view[data-view-panel="settings"] { padding-bottom: 0; }
}

@media (max-width: 760px) {
  .bulk-bar { padding: 10px 12px; gap: 8px; }
  .bulk-select select { width: 132px; }
  .group-strip { flex-wrap: wrap; gap: 8px; }
  .code-search { max-width: none; }
  .links-head { padding: 16px; }
  .tabs { padding: 0 16px; }
  .links-body { padding: 16px; }
  .links-foot { padding: 12px 16px; }
  .settings-panel { padding: 20px 18px; }
}

@media (max-width: 640px) {
  .code-head { height: auto; min-height: 46px; flex-wrap: wrap; gap: 8px; padding: 8px 12px; }
  .code-search { order: 3; flex-basis: 100%; max-width: none; }
  .group-strip { flex-direction: column; align-items: flex-start; }
  .settings-actions { flex-direction: column; align-items: stretch; gap: 10px; }
  .settings-actions-btns { margin-left: 0; }
  .settings-actions-btns .btn { flex: 1; }
  .modal-links { padding: 0; max-height: calc(100vh - 24px); }
  .links-foot { flex-wrap: wrap; }
  .links-foot-note { width: 100%; }
  .links-foot-actions { width: 100%; }
  .links-foot-actions .btn { flex: 1; }
  body.has-bulk .toast-stack { bottom: 128px; }
  .user-row { gap: 10px; padding: 10px 11px; }
  .user-main { flex: 1 1 auto; }
  .user-actions { width: auto; padding-left: 0; margin-left: auto; }
  .user-actions .btn { padding: 0 8px; }
  .user-editor { padding: 14px; }
}

@media (max-width: 560px) {
  .bulk-bar { flex-wrap: wrap; }
  .bulk-count { flex: 1; }
  .bulk-divider { display: none; }
  .bulk-actions { order: 3; width: 100%; margin-left: 0; }
  .bulk-btn { flex: 1; justify-content: center; }
  .bulk-select { flex: 1; }
  .bulk-select select { width: 100%; }
  .bulk-close { position: absolute; right: 6px; top: 6px; }
  .link-region { display: none; }
  .link-kind { min-width: 38px; }
  .inline-field { width: 100%; }
  .inline-field .select-wrap { flex: 1; }
  .inline-field select { width: 100%; }
}

@media (max-width: 480px) {
  .user-editor .field-row { grid-template-columns: 1fr; gap: 12px; }
  .scope-list { grid-template-columns: 1fr; max-height: 200px; }
  .user-editor-actions .btn { flex: 1; }
}

@media (max-width: 400px) {
  .user-badge,
  .user-sub { display: none; }
  .user-row { gap: 8px; }
  .user-avatar { width: 30px; height: 30px; border-radius: var(--r-2); font-size: 12px; }
  .user-actions .btn { padding: 0 7px; font-size: 10.5px; }
  .user-delete { width: 28px; padding: 0; }
}

/* ---------- 16. coordination ---------- */
/* 改版收尾：让侧栏 / 顶栏 / 英雄区 / 卡片共用同一套层次语言。
   只调整视觉，不改结构类名，也不新增 HTML。 */

/* 设置 / 用户页的卡片列是居中的 820px；页头若仍占满整行，
   标题左边缘就会和卡片错开一截，两块内容看起来各说各话。 */
.view[data-view-panel="settings"] > .page-head,
.view[data-view-panel="users"] > .page-head {
  max-width: 820px;
  margin-inline: auto;
}

/* 页头小标题：从一行灰字改成一枚浅靛蓝胶囊，与侧栏 nav-caption 呼应 */
.page-head .eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 11px;
  padding: 3px 11px 3px 9px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--line));
  background: color-mix(in srgb, var(--accent) 7%, var(--panel));
  color: var(--accent-text);
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: .1em;
  line-height: 1.6;
}
.page-head .eyebrow::before {
  content: "";
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: .9;
  flex: none;
}
.page-head h1 { text-wrap: balance; }

/* 面板阴影：1px 描边之外补一层大范围低透明度投影，
   卡片从「贴在背景上的色块」变成「浮起一层」，层级更清楚 */
.panel {
  box-shadow:
    0 1px 2px rgba(16, 24, 40, .04),
    0 18px 36px -30px rgba(16, 24, 40, .3),
    var(--hairline);
}
html[data-theme="dark"] .panel {
  box-shadow:
    0 1px 2px rgba(0, 0, 0, .45),
    0 18px 34px -26px rgba(0, 0, 0, .9),
    var(--hairline);
}

/* 面板头加一道极细分隔线，标题与内容不再「飘在一起」 */
.panel-head {
  padding-bottom: 13px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--line);
}
.panel-head h3 { font-size: 14.5px; }

/* 概览两列面板高度不等，列表按可用空间均分，消除底部那片空白 */
.overview-grid > .panel { display: flex; flex-direction: column; }
.overview-grid > .panel > .bar-list,
.overview-grid > .panel > .region-list {
  flex: 1;
  justify-content: space-evenly;
  gap: 0;
}
.overview-grid > .panel > .mini-list { flex: 1; justify-content: center; }

/* 行悬停反馈：--panel-inset 比 --panel-soft 深一档，白底上才看得出变化 */
.node-row:hover { background: var(--panel-inset); }
.node-row.is-selected:hover { background: var(--accent-soft); }
button.mini-item:hover { background: var(--panel-inset); }
.cell-actions { opacity: .82; }

/* 表头比正文低一档但不再「虚」 */
.node-head { color: var(--muted); letter-spacing: .02em; }

/* 空状态上下留白统一，避免不同面板里高度跳动 */
.bar-empty { padding: 26px 0; }

/* 深色底下状态点的光晕收一点，否则小字号旁边会发糊 */
html[data-theme="dark"] .status-dot {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 12%, transparent);
}

/* 用户列表原本是「卡片里再套一张卡」：外层面板已有描边与投影，
   内层再画一圈边框会显得叠了两层。改成无框列表，只保留行分隔线。 */
.users-panel .user-list {
  border: 0;
  border-radius: 0;
  background: transparent;
}
.users-panel .user-list > .user-row:first-child { border-top: 1px solid var(--line); }
.users-panel .user-row { padding-inline: 4px; }
.users-panel .user-row.is-current {
  border-radius: var(--r-2);
  border-top-color: transparent;
}
.users-panel .user-row.is-current + .user-row { border-top-color: transparent; }

/* 代码面板是整页唯一的深色块：给它一圈靛蓝描边与更强的悬浮感，
   让「订阅预览」在浅色页面里成为明确的视觉焦点 */
.code-panel {
  border-color: color-mix(in srgb, var(--accent) 30%, transparent);
  box-shadow:
    0 34px 64px -44px color-mix(in srgb, var(--accent) 75%, transparent),
    0 1px 2px rgba(0, 0, 0, .18);
}

/* 抽屉 / 弹层与卡片保持同一套圆角与描边 */
.drawer { border-left-color: var(--line-2); }
.modal { border-color: var(--line-2); }

/* 表格面板：圆角由 .panel 统一提供，这里只补一层内描边，
   让表头与卡片上边缘之间有一道清晰的分界 */
.table-panel { box-shadow: var(--shadow-sm), var(--hairline); }

/* 节点页的筛选条与表格原本是两张相邻的卡，中间一道 14px 缝隙；
   合成一张「带筛选头的表格卡」后，筛选与数据成为同一个物件 */
.toolbar.panel {
  position: relative;
  z-index: 1;
  margin-bottom: 0;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  box-shadow: 0 1px 2px rgba(16, 24, 40, .04), var(--hairline);
}
.toolbar.panel + .table-panel {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
  border-top-color: color-mix(in srgb, var(--line) 80%, transparent);
}
@media (max-width: 1120px) {
  .toolbar.panel {
    margin-bottom: 14px;
    border-radius: var(--radius);
    box-shadow: var(--shadow-xs), var(--hairline);
  }
}
</style>
<script nonce="__CSP_NONCE__">
(function () {
  try {
    var saved = localStorage.getItem('th.theme');
    var theme = saved === 'light' || saved === 'dark'
      ? saved
      : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
  } catch (err) {
    document.documentElement.dataset.theme = 'light';
  }
})();
</script>
</head>
<body>

<svg xmlns="http://www.w3.org/2000/svg" class="svg-sprite" aria-hidden="true">
  <defs>
    <symbol id="i-brand" viewBox="0 0 40 40">
      <rect x="0" y="0" width="40" height="40" rx="11" fill="#4f46e5" stroke="none"/>
      <rect x="0.75" y="0.75" width="38.5" height="38.5" rx="10.4" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="1"/>
      <path d="M12 25.5 20 12l8 13.5-8 4.6-8-4.6Z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>
      <circle cx="20" cy="12" r="2.1" fill="#fff" stroke="none"/>
      <circle cx="12" cy="25.5" r="2.1" fill="#fff" opacity=".85" stroke="none"/>
      <circle cx="28" cy="25.5" r="2.1" fill="#fff" opacity=".85" stroke="none"/>
    </symbol>
    <symbol id="i-grid" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></symbol>
    <symbol id="i-server" viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="7" rx="2"/><rect x="3.5" y="13" width="17" height="7" rx="2"/><circle cx="7.5" cy="7.5" r=".9" fill="currentColor" stroke="none"/><circle cx="7.5" cy="16.5" r=".9" fill="currentColor" stroke="none"/><path d="M11 7.5h6M11 16.5h6"/></symbol>
    <symbol id="i-code" viewBox="0 0 24 24"><path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 5l-3 14"/></symbol>
    <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
    <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></symbol>
    <symbol id="i-pen" viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></symbol>
    <symbol id="i-copy" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15.5 9V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5H9"/></symbol>
    <symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6.5 7l.8 12.2A2 2 0 0 0 9.3 21h5.4a2 2 0 0 0 2-1.8L17.5 7M9 7V4.8A1.8 1.8 0 0 1 10.8 3h2.4A1.8 1.8 0 0 1 15 4.8V7"/></symbol>
    <symbol id="i-close" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></symbol>
    <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></symbol>
    <symbol id="i-eye-off" viewBox="0 0 24 24"><path d="M4 4l16 16"/><path d="M9.9 5.2A9.8 9.8 0 0 1 12 5c6 0 9.5 7 9.5 7a17.7 17.7 0 0 1-3.3 4.1M6.1 6.6A17.5 17.5 0 0 0 2.5 12S6 19 12 19a9.7 9.7 0 0 0 4.2-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></symbol>
    <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></symbol>
    <symbol id="i-moon" viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></symbol>
    <symbol id="i-logout" viewBox="0 0 24 24"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9"/></symbol>
    <symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14-4.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4.5L20 15M20 20v-5h-5"/></symbol>
    <symbol id="i-download" viewBox="0 0 24 24"><path d="M12 4v11M7.5 11.5 12 16l4.5-4.5M5 20h14"/></symbol>
    <symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></symbol>
    <symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 4 2.8 20h18.4L12 4Z"/><path d="M12 9.5v5M12 17.6h.01"/></symbol>
    <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.8h.01"/></symbol>
    <symbol id="i-chevron" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></symbol>
    <symbol id="i-arrow-right" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>
    <symbol id="i-power" viewBox="0 0 24 24"><path d="M12 3v8"/><path d="M7.2 6.2a8 8 0 1 0 9.6 0"/></symbol>
    <symbol id="i-layers" viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3.5 12.5 8.5 4.7 8.5-4.7M3.5 16.8l8.5 4.7 8.5-4.7"/></symbol>
    <symbol id="i-zap" viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></symbol>
    <symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.3 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.3-3.6-8.5S9.6 5.9 12 3.5Z"/></symbol>
    <symbol id="i-key" viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l2.5 2.5M19 4l2 2"/></symbol>
    <symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5"/></symbol>
    <symbol id="i-link" viewBox="0 0 24 24"><path d="M10.5 13.5a4.5 4.5 0 0 0 6.4 0l2.6-2.6a4.5 4.5 0 1 0-6.4-6.4L11.5 6"/><path d="M13.5 10.5a4.5 4.5 0 0 0-6.4 0l-2.6 2.6a4.5 4.5 0 1 0 6.4 6.4L12.5 18"/></symbol>
    <symbol id="i-database" viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/></symbol>
    <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3 4.5 6v5.5c0 4.7 3.2 8 7.5 9.5 4.3-1.5 7.5-4.8 7.5-9.5V6L12 3Z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/></symbol>
    <symbol id="i-route" viewBox="0 0 24 24"><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 17.5H14a4 4 0 0 0 0-8H9"/></symbol>
    <symbol id="i-clipboard" viewBox="0 0 24 24"><rect x="5" y="4.5" width="14" height="16" rx="2.5"/><path d="M9 4.5V3.8A1.8 1.8 0 0 1 10.8 2h2.4A1.8 1.8 0 0 1 15 3.8v.7H9Z"/><path d="M9 11h6M9 15h4"/></symbol>
    <symbol id="i-sliders" viewBox="0 0 24 24"><path d="M4 7h9M17.5 7H20M4 17h3M11.5 17H20"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/></symbol>
    <symbol id="i-arrow-up" viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></symbol>
    <symbol id="i-arrow-down" viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></symbol>
    <symbol id="i-upload" viewBox="0 0 24 24"><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5M4.5 16v3.5A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5V16"/></symbol>
    <symbol id="i-more" viewBox="0 0 24 24"><circle cx="12" cy="5.2" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="18.8" r="1.4" fill="currentColor" stroke="none"/></symbol>
    <symbol id="i-calendar" viewBox="0 0 24 24"><rect x="4" y="5.5" width="16" height="15" rx="2.5"/><path d="M8 3.5v4M16 3.5v4M4 10h16M8.5 14h2M13.5 14h2M8.5 17.5h2"/></symbol>
    <symbol id="i-gauge" viewBox="0 0 24 24"><path d="M20.5 15.5a9 9 0 1 0-17 0"/><path d="m12 13 4-4"/><circle cx="12" cy="14.5" r="1.6"/></symbol>
    <symbol id="i-undo" viewBox="0 0 24 24"><path d="M9 7H4v-5"/><path d="M4.5 7.5A8.5 8.5 0 1 1 3.5 14"/></symbol>
  </defs>
</svg>

<div class="auth-screen" id="auth-screen">
  <div class="auth-aurora" aria-hidden="true"><span class="aurora a"></span><span class="aurora b"></span><span class="aurora c"></span></div>
  <div class="auth-shell">
    <aside class="auth-story">
      <div class="auth-story-art" aria-hidden="true">
        <svg viewBox="0 0 520 620" fill="none">
          <defs>
            <linearGradient id="storyLine" x1="80" y1="560" x2="440" y2="60" gradientUnits="userSpaceOnUse">
              <stop stop-color="#818cf8" stop-opacity="0"/>
              <stop offset=".5" stop-color="#a5b4fc" stop-opacity=".55"/>
              <stop offset="1" stop-color="#38bdf8" stop-opacity="0"/>
            </linearGradient>
            <radialGradient id="storyGlow" cx="0.5" cy="0.5" r="0.5">
              <stop stop-color="#6366f1" stop-opacity=".45"/>
              <stop offset="1" stop-color="#6366f1" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <circle cx="330" cy="250" r="220" fill="url(#storyGlow)"/>
          <path d="M40 520C150 470 190 360 250 300s120-120 230-200" stroke="url(#storyLine)" stroke-width="1.2"/>
          <path d="M10 380c120 20 220-30 300-110S430 120 500 70" stroke="url(#storyLine)" stroke-width="1"/>
          <path d="M100 610c60-100 150-160 240-180s140-70 170-150" stroke="url(#storyLine)" stroke-width=".8"/>
          <g stroke="rgba(165,180,252,.25)" stroke-width="1">
            <circle cx="250" cy="300" r="46"/><circle cx="250" cy="300" r="94"/><circle cx="250" cy="300" r="150"/>
          </g>
          <g fill="#c7d2fe">
            <circle cx="250" cy="300" r="4"/><circle cx="360" cy="190" r="3" opacity=".8"/>
            <circle cx="150" cy="430" r="3" opacity=".6"/><circle cx="420" cy="260" r="2.5" opacity=".7"/>
            <circle cx="300" cy="400" r="2" opacity=".5"/>
          </g>
          <g fill="none" stroke="rgba(165,180,252,.35)" stroke-width="1">
            <rect x="352" y="166" width="34" height="26" rx="7"/>
            <rect x="128" y="418" width="28" height="22" rx="6"/>
          </g>
        </svg>
      </div>
      <div class="auth-story-top">
        <span class="brand-tile"><svg class="icon icon-24"><use href="#i-brand"></use></svg></span>
        <span class="brand-word">Transit Hub</span>
      </div>
      <div class="auth-story-copy">
        <span class="eyebrow eyebrow-light">Subscription Console</span>
        <h1>让每一条线路，<br>都在掌控之中。</h1>
        <p>在一个界面里维护节点、策略分组与订阅输出，变更即时同步至所有客户端。</p>
        <ul class="auth-points">
          <li><span class="point-icon"><svg class="icon"><use href="#i-server"></use></svg></span><div><b>结构化节点管理</b><small>VLESS、Hysteria2 等协议一处维护</small></div></li>
          <li><span class="point-icon"><svg class="icon"><use href="#i-code"></use></svg></span><div><b>实时订阅预览</b><small>每次保存自动生成 Clash YAML</small></div></li>
          <li><span class="point-icon"><svg class="icon"><use href="#i-zap"></use></svg></span><div><b>边缘即时生效</b><small>运行在 Cloudflare 全球网络</small></div></li>
        </ul>
      </div>
      <div class="auth-story-foot"><span class="status-dot"></span>Cloudflare Workers · v2.8.0</div>
    </aside>

    <section class="auth-panel">
      <div class="auth-form-head">
        <span class="eyebrow" id="auth-eyebrow">Admin Access</span>
        <h2 id="auth-title">登录控制台</h2>
        <p id="auth-sub">使用管理员账号登录，账号密码保存在你的 KV 中。</p>
      </div>
      <form id="login-form" novalidate>
        <div class="field" id="field-username">
          <label for="login-username">用户名或邮箱</label>
          <div class="input-wrap">
            <span class="input-prefix"><svg class="icon"><use href="#i-user"></use></svg></span>
            <input id="login-username" name="username" type="text" autocomplete="username" spellcheck="false" autocapitalize="none" maxlength="254" placeholder="管理员用户名或邮箱">
          </div>
        </div>
        <div class="field" id="field-password">
          <label for="login-password">密码</label>
          <div class="input-wrap">
            <span class="input-prefix"><svg class="icon"><use href="#i-key"></use></svg></span>
            <input id="login-password" name="password" type="password" autocomplete="current-password" maxlength="128" placeholder="输入密码">
            <button class="input-suffix" type="button" id="login-password-reveal" aria-label="显示密码"><svg class="icon"><use href="#i-eye"></use></svg></button>
          </div>
        </div>
        <div class="field" id="field-confirm" hidden>
          <label for="login-confirm">确认密码</label>
          <div class="input-wrap">
            <span class="input-prefix"><svg class="icon"><use href="#i-shield"></use></svg></span>
            <input id="login-confirm" name="confirm" type="password" autocomplete="new-password" maxlength="128" placeholder="再次输入密码">
          </div>
        </div>
        <div class="field" id="field-setup-token" hidden>
          <label for="login-setup-token">部署恢复令牌</label>
          <div class="input-wrap">
            <span class="input-prefix"><svg class="icon"><use href="#i-key"></use></svg></span>
            <input id="login-setup-token" name="setup-token" type="password" autocomplete="off" spellcheck="false" placeholder="环境变量 ADMIN_TOKEN">
          </div>
          <div class="field-hint">该实例已配置 <code>ADMIN_TOKEN</code>，初始化需要它确认身份；完成后可删除该环境变量。</div>
        </div>
        <div class="field" id="field-token" hidden>
          <label for="login-token">部署恢复令牌</label>
          <div class="input-wrap">
            <span class="input-prefix"><svg class="icon"><use href="#i-key"></use></svg></span>
            <input id="login-token" name="token" type="password" autocomplete="off" spellcheck="false" placeholder="输入 ADMIN_TOKEN">
            <button class="input-suffix" type="button" id="login-token-reveal" aria-label="显示令牌"><svg class="icon"><use href="#i-eye"></use></svg></button>
          </div>
        </div>
        <div class="form-error" id="login-error" role="alert" hidden></div>
        <button class="btn btn-primary btn-lg btn-block" id="login-btn" type="submit">
          <span class="btn-label" id="login-label">登录</span>
          <span class="spinner" hidden></span>
        </button>
      </form>
      <div class="auth-note" id="login-note">
        <svg class="icon"><use href="#i-shield"></use></svg>
        <span>登录状态仅保存在当前标签页，关闭浏览器后自动退出。</span>
      </div>
      <div class="auth-help">
        <span id="login-help">账号密码保存在你的 KV 中；首次打开会自动进入初始化。</span>
        <button class="auth-link" type="button" id="login-recovery" hidden>使用部署恢复令牌</button>
      </div>
    </section>
  </div>
  <footer class="auth-footer">Transit Hub · 安全的管理入口</footer>
</div>

<div class="app" id="app" hidden>
  <aside class="sidebar">
    <div class="side-head">
      <span class="logo-tile"><svg class="icon icon-24"><use href="#i-brand"></use></svg></span>
      <div class="logo-copy"><strong>Transit Hub</strong><span>Subscription Console</span></div>
      <button class="icon-btn mobile-action" id="mobile-theme" title="切换主题" aria-label="切换主题"><svg class="icon"><use href="#i-moon"></use></svg></button>
      <button class="icon-btn mobile-action" id="mobile-logout" title="退出登录" aria-label="退出登录"><svg class="icon"><use href="#i-logout"></use></svg></button>
    </div>
    <nav class="side-nav" aria-label="主导航">
      <span class="nav-caption">工作台</span>
      <button class="nav-item" type="button" data-view="overview" aria-label="概览">
        <svg class="icon"><use href="#i-grid"></use></svg><span class="nav-text">概览</span>
      </button>
      <button class="nav-item" type="button" data-view="nodes" aria-label="节点管理">
        <svg class="icon"><use href="#i-server"></use></svg><span class="nav-text">节点管理</span><span class="nav-badge" id="nav-count">0</span>
      </button>
      <button class="nav-item" type="button" data-view="preview" aria-label="订阅预览">
        <svg class="icon"><use href="#i-code"></use></svg><span class="nav-text">订阅预览</span>
      </button>
      <button class="nav-item" type="button" data-view="users" aria-label="用户管理" data-owner-only>
        <svg class="icon"><use href="#i-user"></use></svg><span class="nav-text">用户管理</span>
      </button>
      <button class="nav-item" type="button" data-view="settings" aria-label="设置">
        <svg class="icon"><use href="#i-sliders"></use></svg><span class="nav-text">设置</span>
      </button>
    </nav>
    <div class="side-foot">
      <button class="storage-card" type="button" id="storage-card">
        <span class="status-dot" id="storage-dot"></span>
        <span class="storage-copy"><small>配置存储</small><strong id="storage-label">正在连接</strong></span>
        <svg class="icon storage-chevron"><use href="#i-chevron"></use></svg>
      </button>
      <button class="storage-hint" id="kv-help-side" type="button">
        <svg class="icon"><use href="#i-database"></use></svg>
        <span id="storage-hint-text">KV 命名空间已绑定</span>
      </button>
      <div class="side-actions">
        <button class="side-action" type="button" id="theme-toggle">
          <svg class="icon theme-icon"><use href="#i-moon"></use></svg>
          <span class="theme-label">深色模式</span>
        </button>
        <button class="side-action" type="button" id="logout">
          <svg class="icon"><use href="#i-logout"></use></svg><span>退出登录</span>
        </button>
      </div>
    </div>
  </aside>

  <div class="workspace">
    <header class="topbar">
      <div class="crumbs"><span>控制台</span><span class="crumb-sep">/</span><strong id="crumb">概览</strong></div>
      <div class="top-actions">
        <span class="mode-pill" id="mode-pill"><span class="status-dot"></span><span id="mode-pill-text">订阅在线</span></span>
      </div>
    </header>

    <main class="content">
      <section class="view" data-view-panel="overview">
        <div class="page-head">
          <div>
            <span class="eyebrow">Overview</span>
            <h1>订阅概览</h1>
            <p class="page-sub">集中管理节点配置，所有变更会即时反映到 Clash 订阅。</p>
          </div>
          <div class="page-head-meta"><span class="status-inline"><span class="status-dot"></span>服务正常</span><span id="overview-updated">—</span></div>
        </div>

        <div class="alert alert-warning" id="kv-alert" hidden>
          <span class="alert-icon"><svg class="icon"><use href="#i-alert"></use></svg></span>
          <div class="alert-copy">
            <strong>配置存储尚未连接</strong>
            <p>当前为只读模式，节点修改无法保存。确认 KV 命名空间 <code>SUB_KV</code> 已自动绑定后重新部署即可启用后台管理。</p>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" id="kv-help-btn">查看绑定步骤</button>
        </div>
        <div class="alert alert-warning" id="corrupt-alert" hidden>
          <span class="alert-icon"><svg class="icon"><use href="#i-alert"></use></svg></span>
          <div class="alert-copy">
            <strong>配置数据读取异常</strong>
            <p>已载入空配置。任意保存操作都会以当前列表重建配置，请确认后再操作。</p>
          </div>
        </div>
        <div class="alert alert-danger" id="token-alert" hidden>
          <span class="alert-icon"><svg class="icon"><use href="#i-key"></use></svg></span>
          <div class="alert-copy">
            <strong>订阅令牌尚未配置</strong>
            <p>订阅链接无法生成。请到「设置 → 访问令牌」填写 <code>AUTH_TOKEN</code>，保存后立即生效，无需重新部署。</p>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" id="token-open-settings"><svg class="icon"><use href="#i-sliders"></use></svg>前往设置</button>
        </div>
        <div class="alert alert-warning" id="empty-sub-alert" hidden>
          <span class="alert-icon"><svg class="icon"><use href="#i-power"></use></svg></span>
          <div class="alert-copy">
            <strong>订阅当前为空</strong>
            <p>所有节点都已停用，客户端刷新后会拿到一份空配置。启用至少一个节点即可恢复。</p>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" id="empty-sub-btn">查看节点</button>
        </div>

        <section class="hero">
          <div class="hero-copy">
            <div class="hero-status"><span class="live-dot"></span><span id="hero-status-text">订阅服务运行中</span><span class="hero-version">v2.8.0</span></div>
            <h2 id="hero-title">节点已就绪，随时同步<br class="hero-br">至你的每一台设备。</h2>
            <p id="hero-desc">编辑节点或调整分组后无需重新部署，客户端下次刷新订阅即可获取最新配置。</p>
            <div class="hero-actions">
              <button class="btn btn-light" type="button" id="hero-add"><svg class="icon"><use href="#i-plus"></use></svg>添加节点</button>
              <button class="btn btn-ghost-light" type="button" id="hero-preview"><svg class="icon"><use href="#i-code"></use></svg>订阅预览</button>
            </div>
            <div class="sub-card">
              <div class="sub-card-head"><span>订阅链接</span><span>包含访问令牌，请妥善保管</span></div>
              <div class="sub-input">
                <svg class="icon"><use href="#i-link"></use></svg>
                <code id="sub-url-text">—</code>
                <button class="sub-icon-btn" type="button" id="sub-reveal" title="显示 / 隐藏令牌" aria-label="显示或隐藏令牌"><svg class="icon"><use href="#i-eye"></use></svg></button>
                <button class="sub-icon-btn" type="button" id="sub-copy" title="复制订阅链接" aria-label="复制订阅链接"><svg class="icon"><use href="#i-copy"></use></svg></button>
              </div>
            </div>
          </div>
          <div class="hero-visual" aria-hidden="true">
            <svg viewBox="0 0 420 360" fill="none">
              <defs>
                <linearGradient id="heroEdge" x1="60" y1="300" x2="360" y2="60" gradientUnits="userSpaceOnUse">
                  <stop stop-color="#6366f1" stop-opacity=".22"/>
                  <stop offset=".5" stop-color="#8b5cf6" stop-opacity=".8"/>
                  <stop offset="1" stop-color="#22d3ee" stop-opacity=".38"/>
                </linearGradient>
                <radialGradient id="heroHalo" cx=".5" cy=".5" r=".5">
                  <stop stop-color="var(--hero-halo)" stop-opacity="1"/><stop offset="1" stop-color="var(--hero-halo)" stop-opacity="0"/>
                </radialGradient>
              </defs>
              <circle cx="230" cy="176" r="170" fill="url(#heroHalo)"/>
              <g stroke="var(--hero-line)" stroke-width="1">
                <circle cx="230" cy="176" r="58"/><circle cx="230" cy="176" r="108"/><circle cx="230" cy="176" r="158"/>
              </g>
              <g stroke="var(--hero-line)" stroke-width="1" stroke-dasharray="2 7">
                <path d="M12 296 408 56M12 176h408M58 46l344 296"/>
              </g>
              <path d="M76 278c66-22 72-104 154-102s78 84 138 28" stroke="url(#heroEdge)" stroke-width="1.6"/>
              <path d="M76 278 230 176l138 28" stroke="var(--hero-line-strong)" stroke-width="1" stroke-dasharray="4 5"/>
              <g>
                <circle cx="230" cy="176" r="26" fill="var(--hero-core)" stroke="var(--hero-ring)"/>
                <circle cx="230" cy="176" r="9" fill="var(--hero-dot)"/>
                <circle cx="230" cy="176" r="16" stroke="var(--hero-ring)"/>
              </g>
              <g fill="var(--hero-node-bg)" stroke="var(--hero-node-ring)">
                <circle cx="76" cy="278" r="16"/>
                <circle cx="368" cy="204" r="13"/>
                <circle cx="330" cy="90" r="10"/>
                <circle cx="112" cy="92" r="9"/>
              </g>
              <g fill="var(--hero-dot)">
                <circle cx="76" cy="278" r="4"/><circle cx="368" cy="204" r="3.2"/><circle cx="330" cy="90" r="2.4"/><circle cx="112" cy="92" r="2.2"/>
              </g>
              <g fill="var(--hero-label)" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="9" letter-spacing="1.4">
                <text x="66" y="316">HKG-01</text><text x="344" y="236">NRT-02</text><text x="314" y="68">LAX-05</text><text x="94" y="70">SIN-03</text>
              </g>
            </svg>
            <div class="hero-visual-meta">
              <span>ACTIVE NODES</span>
              <strong id="hero-node-count">0</strong>
            </div>
          </div>
        </section>

        <div class="stat-grid">
          <article class="stat-card" data-tone="indigo">
            <div class="stat-top"><span class="stat-icon tone-indigo"><svg class="icon"><use href="#i-server"></use></svg></span><span class="stat-badge" id="stat-total-badge">全部</span></div>
            <div class="stat-value" id="stat-total">0</div>
            <div class="stat-label">节点总数</div>
          </article>
          <article class="stat-card" data-tone="emerald">
            <div class="stat-top"><span class="stat-icon tone-emerald"><svg class="icon"><use href="#i-power"></use></svg></span><span class="stat-badge tone-emerald" id="stat-enabled-badge">在线</span></div>
            <div class="stat-value" id="stat-enabled">0</div>
            <div class="stat-label">已启用节点</div>
          </article>
          <article class="stat-card" data-tone="cyan">
            <div class="stat-top"><span class="stat-icon tone-cyan"><svg class="icon"><use href="#i-layers"></use></svg></span><span class="stat-badge" id="stat-types-hint">协议</span></div>
            <div class="stat-value" id="stat-types">0</div>
            <div class="stat-label">协议类型</div>
          </article>
          <article class="stat-card" data-tone="amber">
            <div class="stat-top"><span class="stat-icon tone-amber"><svg class="icon"><use href="#i-route"></use></svg></span><span class="stat-badge" id="stat-regions-hint">策略组</span></div>
            <div class="stat-value" id="stat-regions">0</div>
            <div class="stat-label">策略组总数</div>
          </article>
        </div>

        <div class="overview-grid">
          <section class="panel">
            <div class="panel-head">
              <div><h3>协议分布</h3><p>按已启用节点统计</p></div>
              <span class="soft-pill" id="proto-total">0 在线</span>
            </div>
            <div class="bar-list" id="proto-bars"></div>
          </section>
          <section class="panel">
            <div class="panel-head">
              <div><h3>系统状态</h3><p>运行环境与安全配置</p></div>
              <span class="soft-pill soft-ok" id="sys-health">正常</span>
            </div>
            <ul class="kv-list">
              <li><span class="kv-key"><svg class="icon"><use href="#i-database"></use></svg>KV 存储</span><span class="kv-val" id="sys-kv">—</span></li>
              <li><span class="kv-key"><svg class="icon"><use href="#i-shield"></use></svg>管理认证</span><span class="kv-val" id="sys-auth">—</span></li>
              <li><span class="kv-key"><svg class="icon"><use href="#i-layers"></use></svg>配置版本</span><span class="kv-val mono" id="sys-rev">—</span></li>
              <li><span class="kv-key"><svg class="icon"><use href="#i-refresh"></use></svg>最后更新</span><span class="kv-val" id="sys-updated">—</span></li>
            </ul>
            <p class="panel-note" id="overview-auth-note">登录使用账号密码，可在设置页添加或重置用户；订阅令牌只用于订阅链接。</p>
          </section>
        </div>

        <div class="overview-grid">
          <section class="panel">
            <div class="panel-head">
              <div><h3>策略组构成</h3><p>节点会按所属分组自动编排</p></div>
              <button class="link-btn" type="button" data-goto="preview">查看订阅<svg class="icon"><use href="#i-arrow-right"></use></svg></button>
            </div>
            <div class="region-list" id="region-bars"></div>
          </section>
          <section class="panel">
            <div class="panel-head">
              <div><h3>节点速览</h3><p>当前配置中的前 4 个节点</p></div>
              <button class="link-btn" type="button" data-goto="nodes">全部节点<svg class="icon"><use href="#i-arrow-right"></use></svg></button>
            </div>
            <div class="mini-list" id="recent-nodes"></div>
          </section>
        </div>
      </section>

      <section class="view" data-view-panel="nodes" hidden>
        <div class="page-head">
          <div>
            <span class="eyebrow">Nodes</span>
            <h1>节点管理</h1>
            <p class="page-sub">批量选择后可一次启用、停用、换组或删除；成员账号也能添加只对自己生效的节点。</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-secondary" type="button" id="nodes-export" data-owner-only><svg class="icon"><use href="#i-download"></use></svg>导出备份</button>
            <button class="btn btn-secondary" type="button" id="nodes-import" data-owner-only><svg class="icon"><use href="#i-upload"></use></svg>导入备份</button>
            <button class="btn btn-secondary" type="button" id="nodes-links"><svg class="icon"><use href="#i-link"></use></svg>分享链接</button>
            <button class="btn btn-primary" type="button" id="nodes-add"><svg class="icon"><use href="#i-plus"></use></svg>添加节点</button>
            <input type="file" id="import-file" accept="application/json,.json" hidden>
          </div>
        </div>

        <div class="toolbar panel">
          <div class="search-box">
            <svg class="icon"><use href="#i-search"></use></svg>
            <input id="node-search" type="search" placeholder="搜索名称、服务器、协议或分组" autocomplete="off" spellcheck="false">
            <kbd>/</kbd>
          </div>
          <div class="toolbar-filters">
            <div class="select-wrap">
              <select id="filter-type" aria-label="按协议筛选">
                <option value="all">全部协议</option>
                <option value="vless">VLESS</option>
                <option value="hysteria2">Hysteria2</option>
                <option value="trojan">Trojan</option>
                <option value="vmess">VMess</option>
                <option value="ss">Shadowsocks</option>
              </select>
              <svg class="icon"><use href="#i-chevron"></use></svg>
            </div>
            <div class="select-wrap">
              <select id="filter-region" aria-label="按分组筛选">
                <option value="all">全部分组</option>
                <option value="us">欧美节点</option>
                <option value="jp">日韩节点</option>
                <option value="hk">港台节点</option>
                <option value="relay">中转节点</option>
                <option value="other">未分组</option>
              </select>
              <svg class="icon"><use href="#i-chevron"></use></svg>
            </div>
            <button class="btn btn-quiet btn-sm" type="button" id="filter-reset">重置</button>
          </div>
          <span class="toolbar-count" id="node-count-label">共 0 个节点</span>
        </div>

        <div class="panel table-panel">
          <div class="node-head">
            <span class="cell-check"><input type="checkbox" class="check-input" id="select-all" aria-label="全选当前列表"></span>
            <span>节点</span><span>服务器</span><span>协议</span><span>分组</span><span>状态</span><span class="ta-right">操作</span>
          </div>
          <div class="node-list" id="node-list"></div>
          <div class="empty" id="node-empty" hidden>
            <span class="empty-art"><svg viewBox="0 0 120 90" fill="none">
              <rect x="14" y="18" width="92" height="58" rx="12" stroke="currentColor" stroke-width="1.4" opacity=".35"/>
              <path d="M14 34h92" stroke="currentColor" stroke-width="1.4" opacity=".22"/>
              <circle cx="24" cy="26" r="2" fill="currentColor" opacity=".35"/><circle cx="31" cy="26" r="2" fill="currentColor" opacity=".2"/>
              <rect x="26" y="44" width="42" height="5" rx="2.5" fill="currentColor" opacity=".16"/>
              <rect x="26" y="56" width="28" height="5" rx="2.5" fill="currentColor" opacity=".1"/>
              <path d="M83 48v16M75 56h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".45"/>
            </svg></span>
            <h3>还没有任何节点</h3>
            <p>添加第一个节点后，订阅就会开始生成。</p>
            <div class="empty-actions">
              <button class="btn btn-primary btn-sm" type="button" id="empty-add"><svg class="icon"><use href="#i-plus"></use></svg>添加节点</button>
              <button class="link-btn" type="button" id="empty-links">或从分享链接批量导入<svg class="icon"><use href="#i-arrow-right"></use></svg></button>
            </div>
          </div>
          <div class="empty" id="node-empty-filter" hidden>
            <span class="empty-art"><svg viewBox="0 0 120 90" fill="none">
              <circle cx="54" cy="42" r="22" stroke="currentColor" stroke-width="1.5" opacity=".35"/>
              <path d="m70 58 14 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".35"/>
              <path d="M46 42h16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".25"/>
            </svg></span>
            <h3>没有匹配的节点</h3>
            <p>试试更换关键词或清除筛选条件。</p>
            <button class="btn btn-secondary btn-sm" type="button" id="empty-reset">清除筛选</button>
          </div>
        </div>
      </section>

      <section class="view" data-view-panel="preview" hidden>
        <div class="page-head">
          <div>
            <span class="eyebrow">Preview</span>
            <h1>订阅预览</h1>
            <p class="page-sub">查看当前配置生成的 Clash YAML，保存节点后会自动刷新。</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-secondary" type="button" id="preview-refresh"><svg class="icon"><use href="#i-refresh"></use></svg>刷新</button>
            <button class="btn btn-secondary" type="button" id="preview-download"><svg class="icon"><use href="#i-download"></use></svg>下载</button>
            <button class="btn btn-primary" type="button" id="preview-copy"><svg class="icon"><use href="#i-copy"></use></svg>复制 YAML</button>
          </div>
        </div>

        <div class="sub-strip panel">
          <div class="sub-strip-info">
            <span class="stat-icon tone-indigo"><svg class="icon"><use href="#i-link"></use></svg></span>
            <div><strong>订阅地址</strong><span id="preview-sub-url">—</span></div>
          </div>
          <button class="btn btn-secondary btn-sm" type="button" id="preview-copy-sub"><svg class="icon"><use href="#i-copy"></use></svg>复制链接</button>
        </div>

        <div class="group-strip panel">
          <span class="group-strip-label"><svg class="icon"><use href="#i-layers"></use></svg>策略组</span>
          <div class="group-pills" id="preview-group-pills"></div>
        </div>

        <div class="panel code-panel">
          <div class="code-head">
            <div class="code-file">
              <span class="file-dots"><i></i><i></i><i></i></span>
              <span class="mono">subscription.yaml</span>
              <span class="code-badge">YAML</span>
            </div>
            <div class="code-search">
              <svg class="icon"><use href="#i-search"></use></svg>
              <input id="preview-search" type="search" placeholder="查找配置内容" autocomplete="off" spellcheck="false" aria-label="在订阅配置中查找">
              <span class="code-search-count" id="preview-search-count"></span>
              <button class="code-search-btn" type="button" id="preview-search-prev" aria-label="上一个匹配" title="上一个匹配"><svg class="icon"><use href="#i-arrow-up"></use></svg></button>
              <button class="code-search-btn" type="button" id="preview-search-next" aria-label="下一个匹配" title="下一个匹配"><svg class="icon"><use href="#i-arrow-down"></use></svg></button>
            </div>
            <div class="code-meta"><span id="code-lines">0 行</span><span class="dot-sep"></span><span id="code-size">0 KB</span></div>
          </div>
          <div class="code-body">
            <pre class="code" id="yaml-code"></pre>
            <div class="code-loading" id="code-loading"><span class="spinner"></span>正在生成订阅…</div>
          </div>
        </div>
      </section>

      <section class="view" data-view-panel="users" hidden>
        <div class="page-head">
          <div>
            <span class="eyebrow">Accounts</span>
            <h1>用户管理</h1>
            <p class="page-sub">所有者可添加账号并分配共享节点；成员可以维护自己的节点，但不会改动这里分配的配置。</p>
          </div>
          <div class="page-actions">
            <button class="btn btn-primary" type="button" id="user-add">
              <svg class="icon"><use href="#i-plus"></use></svg>添加用户
            </button>
          </div>
        </div>

        <section class="panel settings-panel users-panel" id="users-panel" data-owner-only>
          <div class="user-list" id="user-list">
            <div class="user-empty">正在载入账号…</div>
          </div>
          <form class="user-editor" id="user-form" hidden novalidate>
            <div class="user-editor-head">
              <b id="user-form-title">添加用户</b>
              <span id="user-form-sub">创建后即可使用该账号登录控制台</span>
            </div>
            <div class="field">
              <label for="user-username">用户名或邮箱</label>
              <input id="user-username" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="254" placeholder="3–254 位用户名，或直接填写邮箱地址">
              <div class="field-error" data-user-error="username"></div>
            </div>
            <div class="field">
              <label for="user-role">账号角色</label>
              <div class="select-wrap select-block">
                <select id="user-role">
                  <option value="member">成员 · 使用分配的节点，可添加个人节点</option>
                  <option value="owner">所有者 · 可管理账号与全部节点</option>
                </select>
                <svg class="icon"><use href="#i-chevron"></use></svg>
              </div>
              <div class="field-error" data-user-error="role"></div>
            </div>
            <div class="field" id="user-scope-field">
              <label>可用节点</label>
              <label class="scope-all"><input class="check-input" type="checkbox" id="user-scope-all"> <span>全部节点</span></label>
              <div class="scope-list" id="user-scope-list"></div>
              <div class="field-error" data-user-error="scope"></div>
            </div>
            <div class="field-row">
              <div class="field">
                <label for="user-password">密码</label>
                <input id="user-password" type="password" autocomplete="new-password" maxlength="128" placeholder="至少 12 位，请勿复用重要密码">
                <div class="field-hint" id="user-password-hint" hidden>留空则不修改密码。</div>
                <div class="field-error" data-user-error="password"></div>
              </div>
              <div class="field">
                <label for="user-password2">确认密码</label>
                <input id="user-password2" type="password" autocomplete="new-password" maxlength="128" placeholder="再次输入密码">
              </div>
            </div>
            <div class="field-error" data-user-error="global"></div>
            <div class="user-editor-actions">
              <button class="btn btn-quiet" type="button" id="user-cancel">取消</button>
              <button class="btn btn-primary" type="submit" id="user-save">
                <span class="spinner" id="user-save-spinner" hidden></span><span class="btn-label" id="user-save-label">添加用户</span>
              </button>
            </div>
          </form>
        </section>
      </section>

      <section class="view" data-view-panel="settings" hidden>
        <div class="page-head">
          <div>
            <span class="eyebrow">Settings</span>
            <h1>设置</h1>
            <p class="page-sub">管理订阅令牌、VLESS 预设与分流参数；成员账号可以查看自己的节点、订阅与密码。</p>
          </div>
          <div class="page-head-meta"><span id="settings-updated">—</span></div>
        </div>

        <section class="panel settings-panel account-panel" id="account-panel" data-member-only hidden>
          <div class="section-head">
            <div>
              <h3>我的账号</h3>
              <p>共享节点由所有者维护；你添加的节点只保存在自己的账号下，订阅链接会合并两者。</p>
            </div>
            <span class="role-badge" id="account-role">成员</span>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="account-username">登录账号</label>
              <input id="account-username" readonly>
            </div>
            <div class="field">
              <label for="account-scope">可用节点</label>
              <input id="account-scope" readonly>
            </div>
          </div>
          <div class="field">
            <label for="account-sub-url">我的订阅链接</label>
            <div class="input-inline">
              <input id="account-sub-url" class="token-input" readonly spellcheck="false">
              <button class="btn btn-quiet btn-sm" type="button" id="account-sub-copy">复制</button>
            </div>
            <div class="field-hint">链接包含分配给你的共享节点和你添加的个人节点；修改密码后旧链接立即失效，这里会自动更新。为避免明文外泄，链接默认掩码显示，点「复制」获取完整地址。</div>
          </div>
          <form class="account-password" id="password-form" novalidate>
            <div class="section-head"><h3>修改密码</h3><p>修改成功后，其他设备上的登录与旧订阅链接会立即失效。</p></div>
            <div class="field">
              <label for="pw-current">当前密码</label>
              <input id="pw-current" type="password" autocomplete="current-password" maxlength="128">
              <div class="field-error" data-error="currentPassword"></div>
            </div>
            <div class="field-row">
              <div class="field">
                <label for="pw-new">新密码</label>
                <input id="pw-new" type="password" autocomplete="new-password" maxlength="128" placeholder="至少 12 位，请勿复用重要密码">
                <div class="field-error" data-error="newPassword"></div>
              </div>
              <div class="field">
                <label for="pw-confirm">确认新密码</label>
                <input id="pw-confirm" type="password" autocomplete="new-password" maxlength="128" placeholder="再次输入新密码">
              </div>
            </div>
            <div class="field-error" data-error="global"></div>
            <div class="account-actions">
              <button class="btn btn-primary" type="submit" id="pw-save">
                <span class="spinner" id="pw-spinner" hidden></span><span class="btn-label" id="pw-save-label">更新密码</span>
              </button>
            </div>
          </form>
        </section>

        <form id="settings-form" novalidate data-owner-only>
          <section class="panel settings-panel">
            <div class="section-head"><h3>访问令牌</h3><p>订阅链接使用此令牌鉴权，仅用于订阅访问，不能登录控制台。保存后立即生效，无需环境变量 AUTH_TOKEN。</p></div>
            <div class="field">
              <label for="set-auth-token">AUTH_TOKEN（订阅令牌）</label>
              <div class="input-inline">
                <input id="set-auth-token" class="token-input" placeholder="留空保持不变；点「生成」或填入新值后保存即替换" spellcheck="false" autocomplete="off">
                <button class="btn btn-quiet btn-sm" type="button" id="gen-auth-token"><svg class="icon"><use href="#i-refresh"></use></svg>生成</button>
                <button class="btn btn-quiet btn-sm" type="button" id="clear-auth-token" title="删除设置页保存的令牌，回退到环境变量 AUTH_TOKEN">清除</button>
              </div>
              <div class="field-error" data-error="setAuthToken"></div>
              <div class="field-hint" id="auth-token-note">当前尚未配置订阅令牌，填写并保存后订阅链接立即可用。</div>
            </div>
            <div class="field">
              <label for="set-provider-base">rule-providers 镜像前缀</label>
              <input id="set-provider-base" placeholder="留空使用 cdn.jsdelivr.net 上的 Loyalsoldier 规则集" spellcheck="false" autocomplete="off">
              <div class="field-error" data-error="setProviderBase"></div>
              <div class="field-hint">分流规则集默认从 jsDelivr 拉取；拉取失败或想自建镜像时填这里。只替换 URL 前缀，规则文件名不变，必须是 <code>https://</code> 开头且不含空格。</div>
            </div>
          </section>

          <section class="panel settings-panel">
            <div class="section-head"><h3>VLESS 默认参数</h3><p>仅在「添加节点」时作为初始值填入；已存在的节点不受影响，仍可逐个单独修改。</p></div>
            <div class="field">
              <label for="set-uuid">固定 UUID</label>
              <div class="input-inline">
                <input id="set-uuid" placeholder="留空则每次新建随机生成" spellcheck="false" autocomplete="off">
                <button class="btn btn-quiet btn-sm" type="button" id="gen-set-uuid"><svg class="icon"><use href="#i-refresh"></use></svg>生成</button>
              </div>
              <div class="field-error" data-error="setUuid"></div>
              <div class="field-hint">多个节点共用同一 UUID（通常是同一台服务器）时填在这里。</div>
            </div>
            <div class="field-row">
              <div class="field">
                <label for="set-pbk">Reality 公钥</label>
                <input id="set-pbk" placeholder="Public Key" spellcheck="false" autocomplete="off">
                <div class="field-error" data-error="setPbk"></div>
              </div>
              <div class="field">
                <label for="set-sid">Reality Short ID</label>
                <input id="set-sid" placeholder="Short ID" spellcheck="false" autocomplete="off">
                <div class="field-error" data-error="setSid"></div>
              </div>
            </div>
            <div class="field-row">
              <div class="field">
                <label for="set-sni">SNI / 回落域名</label>
                <input id="set-sni" placeholder="www.example.com" spellcheck="false" autocomplete="off">
                <div class="field-error" data-error="setSni"></div>
              </div>
              <div class="field field-port">
                <label for="set-port">默认端口</label>
                <input id="set-port" type="number" min="1" max="65535" inputmode="numeric" placeholder="443">
                <div class="field-error" data-error="setPort"></div>
              </div>
            </div>
            <p class="field-hint">新建 VLESS 节点时，UUID、公钥、Short ID、SNI 与端口会自动填入这些值；端口留空则使用 443。</p>
          </section>

          <div class="settings-grid">
            <section class="panel settings-panel">
              <div class="section-head"><h3>订阅信息</h3><p>写入订阅响应头与 YAML 注释，供客户端显示流量条和到期日。</p></div>
              <div class="field-row">
                <div class="field">
                  <label for="set-total">流量上限（GB）</label>
                  <input id="set-total" type="number" min="0" step="0.1" inputmode="decimal" placeholder="留空则不显示">
                  <div class="field-error" data-error="setTotal"></div>
                </div>
                <div class="field">
                  <label for="set-expire">到期日期</label>
                  <input id="set-expire" type="date">
                  <div class="field-error" data-error="setExpire"></div>
                </div>
              </div>
              <p class="field-hint">只影响展示，不参与鉴权或限速；流量与到期都留空时，订阅不会发送 <code>subscription-userinfo</code>。</p>
            </section>

            <section class="panel settings-panel">
              <div class="section-head"><h3>外观</h3><p>选择控制台的配色方式。</p></div>
              <div class="segmented theme-seg" id="theme-mode" role="group" aria-label="外观模式">
                <button type="button" data-theme-mode="system">跟随系统</button>
                <button type="button" data-theme-mode="light">浅色</button>
                <button type="button" data-theme-mode="dark">深色</button>
              </div>
              <div class="appearance-note">
                <svg class="icon"><use href="#i-sun"></use></svg>
                <span id="appearance-note">跟随系统外观，切换会立即生效并记住选择。</span>
              </div>
            </section>
          </div>

          <div class="form-error form-error-block" id="settings-global-error" hidden></div>
          <div class="settings-actions">
            <span class="settings-actions-note"><svg class="icon"><use href="#i-info"></use></svg>保存后立即应用到订阅，无需重新部署。</span>
            <div class="settings-actions-btns">
              <button class="btn btn-quiet" type="button" id="settings-clear">清空 VLESS 预设</button>
              <button class="btn btn-primary" type="submit" id="settings-save"><span class="spinner" hidden></span><span class="btn-label">保存设置</span></button>
            </div>
          </div>
        </form>
      </section>
    </main>

    <div class="bulk-bar" id="bulk-bar" hidden role="region" aria-label="批量操作">
      <span class="bulk-count"><b id="bulk-count">0</b><span>个节点已选</span></span>
      <span class="bulk-divider" aria-hidden="true"></span>
      <div class="bulk-actions">
        <button class="bulk-btn" type="button" data-bulk="enable"><svg class="icon"><use href="#i-power"></use></svg>启用</button>
        <button class="bulk-btn" type="button" data-bulk="disable"><svg class="icon"><use href="#i-power"></use></svg>停用</button>
        <div class="select-wrap bulk-select">
          <select id="bulk-region" aria-label="移动到分组">
            <option value="">移动到分组…</option>
            <option value="us">🇺🇸 欧美节点</option>
            <option value="jp">🇯🇵 日韩节点</option>
            <option value="hk">🇭🇰 港台节点</option>
            <option value="relay">📶 中转节点</option>
            <option value="other">🌐 仅选择列表</option>
          </select>
          <svg class="icon"><use href="#i-chevron"></use></svg>
        </div>
        <button class="bulk-btn is-danger" type="button" data-bulk="delete"><svg class="icon"><use href="#i-trash"></use></svg>删除</button>
      </div>
      <button class="icon-btn bulk-close" type="button" id="bulk-clear" aria-label="取消选择"><svg class="icon"><use href="#i-close"></use></svg></button>
    </div>
  </div>
</div>

<div class="drawer-layer" id="drawer-layer" hidden>
  <div class="drawer-backdrop" data-close-drawer></div>
  <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
    <header class="drawer-head">
      <div class="drawer-title-wrap">
        <span class="drawer-icon"><svg class="icon"><use href="#i-server"></use></svg></span>
        <div><h2 id="drawer-title">添加节点</h2><p id="drawer-sub">配置一个新的代理节点</p></div>
      </div>
      <button class="icon-btn" type="button" data-close-drawer aria-label="关闭"><svg class="icon"><use href="#i-close"></use></svg></button>
    </header>

    <form id="node-form" novalidate>
      <div class="drawer-body">
        <section class="form-section">
          <div class="section-head"><h3>基本信息</h3><p>节点名称会直接显示在客户端节点列表中。</p></div>
          <div class="field">
            <label for="f-name">节点名称 <span class="req">*</span></label>
            <input id="f-name" maxlength="80" placeholder="例如：HK-01 · 香港中转" autocomplete="off" spellcheck="false">
            <div class="field-error" data-error="name"></div>
          </div>
          <div class="field">
            <label>协议类型 <span class="req">*</span></label>
            <div class="type-grid" id="type-grid">
              <button type="button" class="type-card" data-type="vless"><span class="type-mark">VL</span><span>VLESS</span></button>
              <button type="button" class="type-card" data-type="hysteria2"><span class="type-mark">HY2</span><span>Hysteria2</span></button>
              <button type="button" class="type-card" data-type="trojan"><span class="type-mark">TR</span><span>Trojan</span></button>
              <button type="button" class="type-card" data-type="vmess"><span class="type-mark">VM</span><span>VMess</span></button>
              <button type="button" class="type-card" data-type="ss"><span class="type-mark">SS</span><span>Shadowsocks</span></button>
            </div>
          </div>
          <div class="field">
            <label for="f-region">所属分组 <span class="req">*</span></label>
            <div class="select-wrap select-block">
              <select id="f-region">
                <option value="hk">🇭🇰 港台节点</option>
                <option value="jp">🇯🇵 日韩节点</option>
                <option value="us">🇺🇸 欧美节点</option>
                <option value="relay">📶 中转节点</option>
                <option value="other">🌐 仅加入选择列表</option>
              </select>
              <svg class="icon"><use href="#i-chevron"></use></svg>
            </div>
            <div class="field-hint">分组决定节点在客户端策略组中的默认归属。</div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="f-server">服务器地址 <span class="req">*</span></label>
              <input id="f-server" placeholder="IP 或域名" autocomplete="off" spellcheck="false">
              <div class="field-error" data-error="server"></div>
            </div>
            <div class="field field-port">
              <label for="f-port">端口 <span class="req">*</span></label>
              <input id="f-port" type="number" min="1" max="65535" placeholder="443" inputmode="numeric">
              <div class="field-error" data-error="port"></div>
            </div>
          </div>
        </section>

        <section class="form-section proto-section" id="proto-vless">
          <div class="section-head"><h3>VLESS 参数</h3><p>支持 Reality、WebSocket 与 gRPC 传输。</p></div>
          <div class="field">
            <label for="f-uuid">UUID <span class="req">*</span></label>
            <div class="input-inline">
              <input id="f-uuid" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" spellcheck="false" autocomplete="off">
              <button class="btn btn-quiet btn-sm" type="button" id="gen-uuid"><svg class="icon"><use href="#i-refresh"></use></svg>生成</button>
            </div>
            <div class="field-error" data-error="uuid"></div>
          </div>
          <div class="field">
            <label>传输方式</label>
            <div class="segmented" id="f-network">
              <button type="button" data-value="tcp">TCP</button>
              <button type="button" data-value="ws">WebSocket</button>
              <button type="button" data-value="grpc">gRPC</button>
            </div>
            <div class="field-error" data-error="network"></div>
          </div>
          <div class="switch-row">
            <div class="switch-copy"><b>TLS 加密</b><small>通过 TLS 与 SNI 建立加密连接</small></div>
            <button type="button" class="switch" id="f-tls" role="switch" aria-checked="true" aria-label="TLS 加密"></button>
          </div>
          <div class="switch-row" id="reality-row">
            <div class="switch-copy"><b>Reality</b><small>使用 Reality 公钥进行无证书伪装</small></div>
            <button type="button" class="switch" id="f-reality" role="switch" aria-checked="true" aria-label="Reality"></button>
          </div>
          <div class="field-row" id="reality-fields">
            <div class="field">
              <label for="f-pbk">Reality 公钥 <span class="req">*</span></label>
              <input id="f-pbk" placeholder="Public Key" spellcheck="false" autocomplete="off">
              <div class="field-error" data-error="publicKey"></div>
            </div>
            <div class="field">
              <label for="f-sid">Short ID</label>
              <input id="f-sid" placeholder="Short ID" spellcheck="false" autocomplete="off">
              <div class="field-error" data-error="shortId"></div>
            </div>
          </div>
          <div class="field-row" id="tls-fields">
            <div class="field">
              <label for="f-sni">SNI / 回落域名</label>
              <input id="f-sni" placeholder="www.example.com" spellcheck="false" autocomplete="off">
              <div class="field-error" data-error="servername"></div>
            </div>
            <div class="field">
              <label for="f-fp">TLS 指纹</label>
              <div class="select-wrap select-block">
                <select id="f-fp">
                  <option value="chrome">Chrome</option>
                  <option value="firefox">Firefox</option>
                  <option value="safari">Safari</option>
                  <option value="ios">iOS</option>
                  <option value="android">Android</option>
                  <option value="edge">Edge</option>
                  <option value="random">Random</option>
                  <option value="randomized">Randomized</option>
                </select>
                <svg class="icon"><use href="#i-chevron"></use></svg>
              </div>
            </div>
          </div>
          <div class="field" id="flow-field">
            <label for="f-flow">Flow</label>
            <div class="select-wrap select-block">
              <select id="f-flow">
                <option value="">不启用</option>
                <option value="xtls-rprx-vision">xtls-rprx-vision</option>
              </select>
              <svg class="icon"><use href="#i-chevron"></use></svg>
            </div>
          </div>
          <div class="field-row" id="ws-fields" hidden>
            <div class="field">
              <label for="f-wspath">WS Path</label>
              <input id="f-wspath" placeholder="/" spellcheck="false" autocomplete="off">
              <div class="field-error" data-error="wsPath"></div>
            </div>
            <div class="field">
              <label for="f-wshost">WS Host</label>
              <input id="f-wshost" placeholder="可留空" spellcheck="false" autocomplete="off">
              <div class="field-error" data-error="wsHost"></div>
            </div>
          </div>
          <div class="field" id="grpc-fields" hidden>
            <label for="f-grpc">gRPC 服务名</label>
            <input id="f-grpc" placeholder="可留空" spellcheck="false" autocomplete="off">
            <div class="field-error" data-error="grpcService"></div>
          </div>
          <div class="switch-row">
            <div class="switch-copy"><b>UDP 转发</b><small>允许通过该节点转发 UDP 流量</small></div>
            <button type="button" class="switch" id="f-udp" role="switch" aria-checked="true" aria-label="UDP 转发"></button>
          </div>
        </section>

        <section class="form-section proto-section" id="proto-vmess" hidden>
          <div class="section-head"><h3>VMess 参数</h3><p>兼容经典 VMess 与 WebSocket 传输。</p></div>
          <div class="field">
            <label for="f-vm-uuid">UUID <span class="req">*</span></label>
            <div class="input-inline">
              <input id="f-vm-uuid" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" spellcheck="false" autocomplete="off">
              <button class="btn btn-quiet btn-sm" type="button" id="gen-vm-uuid"><svg class="icon"><use href="#i-refresh"></use></svg>生成</button>
            </div>
            <div class="field-error" data-error="vmUuid"></div>
          </div>
          <div class="field">
            <label>传输方式</label>
            <div class="segmented" id="f-vm-network">
              <button type="button" data-value="ws">WebSocket</button>
              <button type="button" data-value="tcp">TCP</button>
              <button type="button" data-value="grpc">gRPC</button>
            </div>
          </div>
          <div class="switch-row">
            <div class="switch-copy"><b>TLS 加密</b><small>为传输层启用 TLS</small></div>
            <button type="button" class="switch" id="f-vm-tls" role="switch" aria-checked="false" aria-label="VMess TLS"></button>
          </div>
          <div class="field" id="vm-tls-field" hidden>
            <label for="f-vm-sni">SNI</label>
            <input id="f-vm-sni" placeholder="www.example.com" spellcheck="false" autocomplete="off">
            <div class="field-error" data-error="vmServername"></div>
          </div>
          <div class="field-row" id="vm-ws-fields">
            <div class="field">
              <label for="f-vm-wspath">WS Path</label>
              <input id="f-vm-wspath" placeholder="/" spellcheck="false" autocomplete="off">
              <div class="field-error" data-error="vmWsPath"></div>
            </div>
            <div class="field">
              <label for="f-vm-wshost">WS Host</label>
              <input id="f-vm-wshost" placeholder="可留空" spellcheck="false" autocomplete="off">
              <div class="field-error" data-error="vmWsHost"></div>
            </div>
          </div>
          <div class="field" id="vm-grpc-fields" hidden>
            <label for="f-vm-grpc">gRPC 服务名</label>
            <input id="f-vm-grpc" placeholder="可留空" spellcheck="false" autocomplete="off">
            <div class="field-error" data-error="vmGrpcService"></div>
          </div>
          <div class="switch-row">
            <div class="switch-copy"><b>UDP 转发</b><small>允许通过该节点转发 UDP 流量</small></div>
            <button type="button" class="switch" id="f-vm-udp" role="switch" aria-checked="true" aria-label="VMess UDP"></button>
          </div>
        </section>

        <section class="form-section proto-section" id="proto-trojan" hidden>
          <div class="section-head"><h3>Trojan 参数</h3><p>基于 TLS 的经典 Trojan 协议。</p></div>
          <div class="field">
            <label for="f-tr-password">密码 <span class="req">*</span></label>
            <div class="input-inline">
              <input id="f-tr-password" type="text" placeholder="节点认证密码" spellcheck="false" autocomplete="off">
              <button class="btn btn-quiet btn-sm" type="button" id="gen-tr-password"><svg class="icon"><use href="#i-refresh"></use></svg>随机</button>
            </div>
            <div class="field-error" data-error="trPassword"></div>
          </div>
          <div class="field">
            <label for="f-tr-sni">SNI</label>
            <input id="f-tr-sni" placeholder="www.example.com" spellcheck="false" autocomplete="off">
            <div class="field-error" data-error="trSni"></div>
          </div>
          <div class="switch-row">
            <div class="switch-copy"><b>跳过证书校验</b><small>仅在自签证书且确认链路可信时开启，默认校验</small></div>
            <button type="button" class="switch" id="f-tr-skip" role="switch" aria-checked="false" aria-label="跳过证书校验"></button>
          </div>
          <div class="switch-row">
            <div class="switch-copy"><b>UDP 转发</b><small>允许通过该节点转发 UDP 流量</small></div>
            <button type="button" class="switch" id="f-tr-udp" role="switch" aria-checked="true" aria-label="Trojan UDP"></button>
          </div>
        </section>

        <section class="form-section proto-section" id="proto-hysteria2" hidden>
          <div class="section-head"><h3>Hysteria2 参数</h3><p>基于 QUIC 的高速传输，适合高延迟网络。</p></div>
          <div class="field">
            <label for="f-hy-password">密码 <span class="req">*</span></label>
            <div class="input-inline">
              <input id="f-hy-password" type="text" placeholder="节点认证密码" spellcheck="false" autocomplete="off">
              <button class="btn btn-quiet btn-sm" type="button" id="gen-hy-password"><svg class="icon"><use href="#i-refresh"></use></svg>随机</button>
            </div>
            <div class="field-error" data-error="hyPassword"></div>
          </div>
          <div class="field">
            <label for="f-hy-sni">SNI</label>
            <input id="f-hy-sni" placeholder="bing.com" spellcheck="false" autocomplete="off">
            <div class="field-error" data-error="hySni"></div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="f-hy-up">上行带宽</label>
              <input id="f-hy-up" placeholder="80 mbps" spellcheck="false" autocomplete="off">
              <div class="field-error" data-error="hyUp"></div>
            </div>
            <div class="field">
              <label for="f-hy-down">下行带宽</label>
              <input id="f-hy-down" placeholder="500 mbps" spellcheck="false" autocomplete="off">
              <div class="field-error" data-error="hyDown"></div>
            </div>
          </div>
          <div class="switch-row">
            <div class="switch-copy"><b>跳过证书校验</b><small>仅在自签证书且确认链路可信时开启，默认校验</small></div>
            <button type="button" class="switch" id="f-hy-skip" role="switch" aria-checked="false" aria-label="跳过证书校验"></button>
          </div>
        </section>

        <section class="form-section proto-section" id="proto-ss" hidden>
          <div class="section-head"><h3>Shadowsocks 参数</h3><p>轻量、兼容性好的经典加密代理。</p></div>
          <div class="field">
            <label for="f-ss-cipher">加密方式</label>
            <div class="select-wrap select-block">
              <select id="f-ss-cipher">
                <option value="aes-256-gcm">aes-256-gcm</option>
                <option value="aes-128-gcm">aes-128-gcm</option>
                <option value="chacha20-ietf-poly1305">chacha20-ietf-poly1305</option>
                <option value="xchacha20-ietf-poly1305">xchacha20-ietf-poly1305</option>
              </select>
              <svg class="icon"><use href="#i-chevron"></use></svg>
            </div>
          </div>
          <div class="field">
            <label for="f-ss-password">密码 <span class="req">*</span></label>
            <div class="input-inline">
              <input id="f-ss-password" type="text" placeholder="节点认证密码" spellcheck="false" autocomplete="off">
              <button class="btn btn-quiet btn-sm" type="button" id="gen-ss-password"><svg class="icon"><use href="#i-refresh"></use></svg>随机</button>
            </div>
            <div class="field-error" data-error="ssPassword"></div>
          </div>
          <div class="switch-row">
            <div class="switch-copy"><b>UDP 转发</b><small>允许通过该节点转发 UDP 流量</small></div>
            <button type="button" class="switch" id="f-ss-udp" role="switch" aria-checked="true" aria-label="Shadowsocks UDP"></button>
          </div>
        </section>

        <section class="form-section">
          <div class="section-head"><h3>应用策略</h3><p>勾选后，节点会额外加入对应的应用策略组。</p></div>
          <div class="chip-grid" id="tag-grid">
            <label class="tag-chip"><input type="checkbox" value="chatgpt"><span>💬 ChatGPT</span></label>
            <label class="tag-chip"><input type="checkbox" value="google"><span>Ⓖ Google</span></label>
            <label class="tag-chip"><input type="checkbox" value="youtube"><span>📺 YouTube</span></label>
            <label class="tag-chip"><input type="checkbox" value="telegram"><span>📲 Telegram</span></label>
          </div>
        </section>

        <section class="form-section">
          <div class="switch-row">
            <div class="switch-copy"><b>在「🌍选择节点」中显示</b><small>关闭后，该节点仍会出现在所属分组与应用策略组中，但不会列入全局选择列表。</small></div>
            <button type="button" class="switch" id="f-show-main" role="switch" aria-checked="true" aria-label="在选择节点中显示"></button>
          </div>
          <div class="switch-row switch-row-last">
            <div class="switch-copy"><b>启用此节点</b><small>停用后节点不会出现在订阅中，但配置会保留。</small></div>
            <button type="button" class="switch" id="f-enabled" role="switch" aria-checked="true" aria-label="启用节点"></button>
          </div>
        </section>
        <div class="form-error form-error-block" id="form-global-error" hidden></div>
      </div>
      <footer class="drawer-foot">
        <span class="kbd-hint"><kbd>esc</kbd> 取消<span>·</span><kbd>⌘</kbd><kbd>S</kbd> 保存</span>
        <div class="drawer-foot-actions">
          <button class="btn btn-secondary" type="button" data-close-drawer>取消</button>
          <button class="btn btn-primary" type="submit" id="node-save"><span class="spinner" hidden></span><span class="btn-label">保存节点</span></button>
        </div>
      </footer>
    </form>
  </aside>
</div>

<div class="modal-layer" id="generic-layer" hidden>
  <div class="modal-backdrop" data-close-modal="generic"></div>
  <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="generic-title">
    <span class="modal-icon tone-rose" id="generic-icon"><svg class="icon"><use href="#i-trash"></use></svg></span>
    <h2 id="generic-title">确认操作</h2>
    <p id="generic-body">—</p>
    <div class="modal-actions">
      <button class="btn btn-secondary" type="button" data-close-modal="generic">取消</button>
      <button class="btn btn-danger" type="button" id="generic-ok">确认</button>
    </div>
  </div>
</div>

<div class="modal-layer" id="kv-layer" hidden>
  <div class="modal-backdrop" data-close-modal="kv"></div>
  <div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="kv-title">
    <span class="modal-icon tone-indigo"><svg class="icon"><use href="#i-database"></use></svg></span>
    <h2 id="kv-title">绑定 KV 存储</h2>
    <p class="modal-sub">管理操作需要持久化配置。项目已内置自动绑定，通常无需任何手动步骤。</p>
    <ol class="steps">
      <li><span class="step-no">1</span><div><b>确认 wrangler.toml 中的绑定声明</b><p>仓库内 <code>wrangler.toml</code> 已声明 <code>[[kv_namespaces]]</code>，绑定名固定为 <code>SUB_KV</code>，且不写 <code>id</code>。</p></div></li>
      <li><span class="step-no">2</span><div><b>重新部署即可自动创建并绑定</b><p>Cloudflare 连接 GitHub 后，每次推送都会执行 <code>wrangler deploy</code>，此时 Wrangler 会自动创建（或复用）KV 命名空间并完成绑定。</p></div></li>
      <li><span class="step-no">3</span><div><b>若仍提示未绑定</b><p>在「存储和数据库 → KV」手动创建一个命名空间，把它的 ID 填到 <code>wrangler.toml</code> 的 <code>id</code> 字段后重新部署。</p></div></li>
    </ol>
    <div class="modal-note"><svg class="icon"><use href="#i-info"></use></svg><span>KV 绑定成功后，首次访问会自动写入一份空配置，之后所有节点都由你在控制台维护。</span></div>
    <div class="modal-actions">
      <button class="btn btn-secondary" type="button" data-close-modal="kv">稍后处理</button>
      <button class="btn btn-primary" type="button" id="kv-copy-name"><svg class="icon"><use href="#i-copy"></use></svg>复制变量名</button>
    </div>
  </div>
</div>

<div class="row-menu" id="row-menu" role="menu" aria-label="节点操作" hidden>
  <button class="menu-item" type="button" role="menuitem" data-menu="share"><svg class="icon"><use href="#i-link"></use></svg>复制分享链接</button>
  <button class="menu-item" type="button" role="menuitem" data-menu="server"><svg class="icon"><use href="#i-copy"></use></svg>复制服务器地址</button>
  <button class="menu-item" type="button" role="menuitem" data-menu="duplicate"><svg class="icon"><use href="#i-copy"></use></svg>创建副本</button>
  <span class="menu-sep" aria-hidden="true"></span>
  <button class="menu-item is-danger" type="button" role="menuitem" data-menu="delete"><svg class="icon"><use href="#i-trash"></use></svg>删除节点</button>
</div>

<div class="modal-layer" id="links-layer" hidden>
  <div class="modal-backdrop" data-close-modal="links"></div>
  <div class="modal modal-links" role="dialog" aria-modal="true" aria-labelledby="links-title">
    <header class="links-head">
      <span class="modal-icon tone-indigo"><svg class="icon"><use href="#i-link"></use></svg></span>
      <div class="links-title-wrap">
        <h2 id="links-title">分享链接</h2>
        <p>批量导入现有节点，或导出一份可迁移的链接清单。</p>
      </div>
      <button class="icon-btn" type="button" data-close-modal="links" aria-label="关闭"><svg class="icon"><use href="#i-close"></use></svg></button>
    </header>

    <div class="tabs" role="tablist" aria-label="分享链接模式">
      <button class="tab is-active" type="button" role="tab" data-tab="import" aria-selected="true">批量导入</button>
      <button class="tab" type="button" role="tab" data-tab="export" aria-selected="false">导出链接</button>
    </div>

    <div class="links-body">
      <div class="tab-panel" data-tab-panel="import">
        <div class="field">
          <label for="links-input">粘贴分享链接</label>
          <textarea class="textarea links-input" id="links-input" rows="7" wrap="off" spellcheck="false" autocomplete="off"
            placeholder="每行一条，例如：&#10;vless://uuid@example.com:443?security=reality&amp;pbk=...&amp;sni=...&amp;type=tcp#HK-01&#10;hysteria2://password@example.com:443?sni=bing.com#JP-01&#10;vmess://eyJ2IjoiMiIsInBzIjoi..."></textarea>
          <div class="field-hint">支持 VLESS、Hysteria2、Trojan、VMess、Shadowsocks；无法识别或暂不支持的参数会跳过并说明原因。</div>
        </div>
        <div class="links-options">
          <div class="inline-field">
            <label for="links-region">归入分组</label>
            <div class="select-wrap">
              <select id="links-region">
                <option value="auto">自动识别</option>
                <option value="hk">🇭🇰 港台节点</option>
                <option value="jp">🇯🇵 日韩节点</option>
                <option value="us">🇺🇸 欧美节点</option>
                <option value="relay">📶 中转节点</option>
                <option value="other">🌐 仅选择列表</option>
              </select>
              <svg class="icon"><use href="#i-chevron"></use></svg>
            </div>
          </div>
          <span class="soft-pill" id="links-summary">等待粘贴</span>
        </div>
        <div class="links-feedback" id="links-feedback" hidden></div>
        <div class="links-preview" id="links-preview"></div>
      </div>

      <div class="tab-panel" data-tab-panel="export" hidden>
        <div class="links-export-head">
          <p>仅导出已启用节点，可直接粘贴到其他客户端或订阅管理器。</p>
          <span class="soft-pill" id="links-export-count">0 条</span>
        </div>
        <pre class="links-export" id="links-export"></pre>
        <div class="links-export-actions">
          <button class="btn btn-secondary btn-sm" type="button" id="links-download"><svg class="icon"><use href="#i-download"></use></svg>下载 .txt</button>
          <button class="btn btn-primary btn-sm" type="button" id="links-copy-all"><svg class="icon"><use href="#i-copy"></use></svg>复制全部</button>
        </div>
      </div>
    </div>

    <footer class="links-foot">
      <span class="links-foot-note" id="links-foot-note">命名冲突会自动追加序号</span>
      <div class="links-foot-actions">
        <button class="btn btn-secondary" type="button" data-close-modal="links">取消</button>
        <button class="btn btn-primary" type="button" id="links-confirm" disabled>导入节点</button>
      </div>
    </footer>
  </div>
</div>

<div class="toast-stack" id="toasts" role="status" aria-live="polite"></div>

<script nonce="__CSP_NONCE__">(function () {
  'use strict';

  var STORAGE_KEY = 'th.admin.token';
  var USERNAME_KEY = 'th.username';
  var THEME_KEY = 'th.theme';
  var MAIN_GROUP = '🌍选择节点';
  var MAX_NODES = 300;
  var MAX_PERSONAL_NODES = 100;
  var MAX_TOTAL_GB = 1048576;
  var THEME_MODES = ['system', 'light', 'dark'];
  var MAX_USERS = 20;
  var PASSWORD_MIN = 12;
  var USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._+@-]{2,253}$/;
  var FINGERPRINTS = ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random', 'randomized'];
  var SS_CIPHERS = ['aes-128-gcm', 'aes-256-gcm', 'chacha20-ietf-poly1305', 'xchacha20-ietf-poly1305'];

  var REGION_META = {
    us: { group: '🇺🇸欧美节点', short: '欧美', flag: '🇺🇸' },
    jp: { group: '🇯🇵日韩节点', short: '日韩', flag: '🇯🇵' },
    hk: { group: '🇭🇰港台节点', short: '港台', flag: '🇭🇰' },
    relay: { group: '📶中转节点', short: '中转', flag: '📶' },
    other: { group: MAIN_GROUP, short: '未分组', flag: '🌐' }
  };
  var REGION_ORDER = ['us', 'jp', 'hk', 'relay', 'other'];

  var TYPE_META = {
    vless: { label: 'VLESS', color: '#4f46e5' },
    hysteria2: { label: 'Hysteria2', color: '#db2777' },
    trojan: { label: 'Trojan', color: '#d97706' },
    vmess: { label: 'VMess', color: '#0891b2' },
    ss: { label: 'Shadowsocks', color: '#059669' }
  };
  var TYPE_ORDER = ['vless', 'hysteria2', 'trojan', 'vmess', 'ss'];

  var TAG_META = {
    chatgpt: { emoji: '💬', label: 'ChatGPT' },
    google: { emoji: 'Ⓖ', label: 'Google' },
    youtube: { emoji: '📺', label: 'YouTube' },
    telegram: { emoji: '📲', label: 'Telegram' }
  };
  var TAG_ORDER = ['chatgpt', 'google', 'youtube', 'telegram'];

  var APP_GROUPS = [
    { key: 'chatgpt', name: '💬ChatGPT' },
    { key: 'google', name: 'ⒼGoogle' },
    { key: 'youtube', name: '📺YOUTUBE' },
    { key: 'telegram', name: '📲 电报信息' }
  ];

  var RESERVED_NAMES = new Set([
    MAIN_GROUP, '🇺🇸欧美节点', '🇯🇵日韩节点', '🇭🇰港台节点', '📶中转节点',
    '💬ChatGPT', 'ⒼGoogle', '📺YOUTUBE', '📲 电报信息',
    'DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'GLOBAL'
  ]);

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var HOST_RE = /^[A-Za-z0-9._%:\\-\\[\\]]+$/;
  var BANDWIDTH_RE = /^\\d{1,6}(?:\\.\\d{1,2})?\\s*(kbps|mbps|gbps)$/i;
  var CONTROL_RE = /[\\u0000-\\u001f\\u007f]/;

  var VIEW_META = {
    overview: '概览',
    nodes: '节点管理',
    preview: '订阅预览',
    users: '用户管理',
    settings: '设置'
  };

  var state = {
    token: '',
    authInfo: null,
    loginView: 'login',
    config: null,
    meta: null,
    rev: 0,
    users: null,
    usersRev: 0,
    currentUserId: null,
    usersLoading: false,
    userFormMode: 'add',
    userFormId: null,
    userDeletingId: null,
    userBusy: false,
    passwordBusy: false,
    view: 'overview',
    query: '',
    filterType: 'all',
    filterRegion: 'all',
    preview: '',
    previewDirty: true,
    previewLoading: false,
    previewPromise: null,
    previewQuery: '',
    previewHits: [],
    previewHitIndex: -1,
    previewSearchTimer: 0,
    editingId: null,
    deletingId: null,
    formType: 'vless',
    subRevealed: false,
    mutating: false,
    selected: new Set(),
    selectionAnchorId: null,
    menuNodeId: null,
    menuTrigger: null,
    linksParsed: [],
    linksErrors: [],
    linksTab: 'import',
    linksTimer: 0,
    linksExportText: '',
    /* 点击「清除」后置位：保存时下发 authToken: null，删除设置页令牌回退环境变量 */
    clearAuthToken: false,
    drawerFocus: null,
    layerFocus: {}
  };

  var el = {};

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (char) {
      return ESC_MAP[char];
    });
  }

  function icon(name, className) {
    return '<svg class="' + (className || 'icon') + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  function storageGet(store, key) {
    try {
      return (store === 'local' ? window.localStorage : window.sessionStorage).getItem(key);
    } catch (err) {
      return null;
    }
  }

  function storageSet(store, key, value) {
    try {
      if (store === 'local') window.localStorage.setItem(key, value);
      else window.sessionStorage.setItem(key, value);
    } catch (err) {
      /* storage unavailable */
    }
  }

  function storageRemove(store, key) {
    try {
      if (store === 'local') window.localStorage.removeItem(key);
      else window.sessionStorage.removeItem(key);
    } catch (err) {
      /* storage unavailable */
    }
  }

  function randomId(prefix) {
    var head = prefix || 'n_';
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return head + window.crypto.randomUUID();
    }
    return head + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function newNodeId() {
    return randomId(isOwner() ? 'n_' : 'p_');
  }

  function generateUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(bytes, function (byte) {
      return byte.toString(16).padStart(2, '0');
    });
    return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' + hex.slice(6, 8).join('') + '-' +
      hex.slice(8, 10).join('') + '-' + hex.slice(10, 16).join('');
  }

  function generatePassword(length) {
    var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    var bytes = new Uint8Array(length || 18);
    window.crypto.getRandomValues(bytes);
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  }

  function formatShort(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date).replace(/\\//g, '-');
  }

  function formatFull(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date).replace(/\\//g, '-');
  }

  class ApiError extends Error {
    constructor(message, status, data, field) {
      super(message);
      this.name = 'ApiError';
      this.status = status || 0;
      this.data = data || null;
      this.field = field || null;
    }
  }

  async function request(path, options) {
    var opts = options || {};
    var headers = { authorization: 'Bearer ' + state.token };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    var response;
    try {
      response = await fetch(path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        cache: 'no-store'
      });
    } catch (err) {
      throw new ApiError('网络请求失败，请检查连接后重试', 0);
    }

    if (response.status === 401) {
      var unauthorized = await safeJson(response);
      throw new ApiError((unauthorized && unauthorized.error) || '登录已失效，请重新验证', 401, unauthorized);
    }

    if (!response.ok) {
      var data = await safeJson(response);
      throw new ApiError(
        (data && data.error) || ('请求失败（HTTP ' + response.status + '）'),
        response.status,
        data,
        data && data.field
      );
    }

    if (opts.raw) return await response.text();
    return await response.json();
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch (err) {
      return null;
    }
  }

  function cacheElements() {
    el.authScreen = $('#auth-screen');
    el.app = $('#app');
    el.loginForm = $('#login-form');
    el.authEyebrow = $('#auth-eyebrow');
    el.authTitle = $('#auth-title');
    el.authSub = $('#auth-sub');
    el.loginUsername = $('#login-username');
    el.loginPassword = $('#login-password');
    el.loginConfirm = $('#login-confirm');
    el.loginSetupToken = $('#login-setup-token');
    el.loginToken = $('#login-token');
    el.fieldUsername = $('#field-username');
    el.fieldPassword = $('#field-password');
    el.fieldConfirm = $('#field-confirm');
    el.fieldSetupToken = $('#field-setup-token');
    el.fieldToken = $('#field-token');
    el.loginPasswordReveal = $('#login-password-reveal');
    el.loginTokenReveal = $('#login-token-reveal');
    el.loginRecovery = $('#login-recovery');
    el.loginNote = $('#login-note');
    el.loginHelp = $('#login-help');
    el.loginError = $('#login-error');
    el.loginBtn = $('#login-btn');
    el.loginLabel = $('#login-label');
    el.loginSpinner = $('.spinner', el.loginBtn);

    el.navItems = $$('.nav-item[data-view]');
    el.views = $$('.view[data-view-panel]');
    el.crumb = $('#crumb');
    el.navCount = $('#nav-count');
    el.modePill = $('#mode-pill');
    el.modePillText = $('#mode-pill-text');

    el.kvAlert = $('#kv-alert');
    el.corruptAlert = $('#corrupt-alert');
    el.tokenAlert = $('#token-alert');
    el.tokenOpenSettings = $('#token-open-settings');
    el.emptySubAlert = $('#empty-sub-alert');
    el.emptySubBtn = $('#empty-sub-btn');
    el.kvHelpBtn = $('#kv-help-btn');
    el.overviewUpdated = $('#overview-updated');
    el.heroStatusText = $('#hero-status-text');
    el.heroTitle = $('#hero-title');
    el.heroDesc = $('#hero-desc');
    el.heroVersion = $('.hero-version');
    el.heroNodeCount = $('#hero-node-count');
    el.subUrlText = $('#sub-url-text');
    el.subReveal = $('#sub-reveal');
    el.subCopy = $('#sub-copy');

    el.statTotal = $('#stat-total');
    el.statEnabled = $('#stat-enabled');
    el.statTypes = $('#stat-types');
    el.statRegions = $('#stat-regions');
    el.statEnabledBadge = $('#stat-enabled-badge');
    el.statTypesHint = $('#stat-types-hint');
    el.protoTotal = $('#proto-total');
    el.protoBars = $('#proto-bars');
    el.regionBars = $('#region-bars');
    el.recentNodes = $('#recent-nodes');
    el.sysKv = $('#sys-kv');
    el.sysAuth = $('#sys-auth');
    el.overviewAuthNote = $('#overview-auth-note');
    el.sysRev = $('#sys-rev');
    el.sysUpdated = $('#sys-updated');
    el.sysHealth = $('#sys-health');

    el.storageCard = $('#storage-card');
    el.storageDot = $('#storage-dot');
    el.storageLabel = $('#storage-label');
    el.storageHint = $('#storage-hint-text');
    el.kvHelpSide = $('#kv-help-side');
    el.themeToggle = $('#theme-toggle');
    el.mobileTheme = $('#mobile-theme');
    el.logout = $('#logout');
    el.mobileLogout = $('#mobile-logout');

    el.nodesAdd = $('#nodes-add');
    el.nodesLinks = $('#nodes-links');
    el.nodeSearch = $('#node-search');
    el.filterType = $('#filter-type');
    el.filterRegion = $('#filter-region');
    el.filterReset = $('#filter-reset');
    el.nodeCountLabel = $('#node-count-label');
    el.nodeHead = $('.node-head');
    el.nodeList = $('#node-list');
    el.nodeEmpty = $('#node-empty');
    el.nodeEmptyFilter = $('#node-empty-filter');
    el.emptyAdd = $('#empty-add');
    el.emptyLinks = $('#empty-links');
    el.emptyReset = $('#empty-reset');
    el.selectAll = $('#select-all');
    el.bulkBar = $('#bulk-bar');
    el.bulkCount = $('#bulk-count');
    el.bulkRegion = $('#bulk-region');
    el.bulkClear = $('#bulk-clear');
    el.rowMenu = $('#row-menu');

    el.heroAdd = $('#hero-add');
    el.heroPreview = $('#hero-preview');
    el.previewRefresh = $('#preview-refresh');
    el.previewDownload = $('#preview-download');
    el.previewCopy = $('#preview-copy');
    el.previewSubUrl = $('#preview-sub-url');
    el.previewCopySub = $('#preview-copy-sub');
    el.previewGroupPills = $('#preview-group-pills');
    el.previewSearch = $('#preview-search');
    el.previewSearchCount = $('#preview-search-count');
    el.previewSearchPrev = $('#preview-search-prev');
    el.previewSearchNext = $('#preview-search-next');
    el.yamlCode = $('#yaml-code');
    el.codeBody = $('.code-body');
    el.codeLoading = $('#code-loading');
    el.codeLines = $('#code-lines');
    el.codeSize = $('#code-size');

    el.drawerLayer = $('#drawer-layer');
    el.drawerTitle = $('#drawer-title');
    el.drawerSub = $('#drawer-sub');
    el.nodeForm = $('#node-form');
    el.nodeSave = $('#node-save');
    el.nodeSaveLabel = $('.btn-label', el.nodeSave);
    el.nodeSaveSpinner = $('.spinner', el.nodeSave);
    el.formGlobalError = $('#form-global-error');
    el.typeGrid = $('#type-grid');
    el.tagGrid = $('#tag-grid');
    el.realityRow = $('#reality-row');
    el.realityFields = $('#reality-fields');
    el.tlsFields = $('#tls-fields');
    el.flowField = $('#flow-field');
    el.wsFields = $('#ws-fields');
    el.grpcFields = $('#grpc-fields');
    el.vmTlsField = $('#vm-tls-field');
    el.vmWsFields = $('#vm-ws-fields');
    el.vmGrpcFields = $('#vm-grpc-fields');

    el.fieldName = $('#f-name');
    el.fieldRegion = $('#f-region');
    el.fieldServer = $('#f-server');
    el.fieldPort = $('#f-port');
    el.fieldEnabled = $('#f-enabled');
    el.fieldShowMain = $('#f-show-main');

    el.settingsForm = $('#settings-form');
    el.usersPanel = $('#users-panel');
    el.userList = $('#user-list');
    el.userAdd = $('#user-add');
    el.userForm = $('#user-form');
    el.userFormTitle = $('#user-form-title');
    el.userFormSub = $('#user-form-sub');
    el.userUsername = $('#user-username');
    el.userRole = $('#user-role');
    el.userScopeField = $('#user-scope-field');
    el.userScopeAll = $('#user-scope-all');
    el.userScopeList = $('#user-scope-list');
    el.userPassword = $('#user-password');
    el.userPassword2 = $('#user-password2');
    el.userPasswordHint = $('#user-password-hint');
    el.userCancel = $('#user-cancel');
    el.userSave = $('#user-save');
    el.userSaveLabel = $('#user-save-label');
    el.userSaveSpinner = $('#user-save-spinner');
    el.accountPanel = $('#account-panel');
    el.accountRole = $('#account-role');
    el.accountUsername = $('#account-username');
    el.accountScope = $('#account-scope');
    el.accountSubUrl = $('#account-sub-url');
    el.accountSubCopy = $('#account-sub-copy');
    el.passwordForm = $('#password-form');
    el.pwCurrent = $('#pw-current');
    el.pwNew = $('#pw-new');
    el.pwConfirm = $('#pw-confirm');
    el.pwSave = $('#pw-save');
    el.pwSaveLabel = $('#pw-save-label');
    el.pwSpinner = $('#pw-spinner');
    el.setAuthToken = $('#set-auth-token');
    el.authTokenNote = $('#auth-token-note');
    el.genAuthToken = $('#gen-auth-token');
    el.clearAuthToken = $('#clear-auth-token');
    el.setProviderBase = $('#set-provider-base');
    el.setUuid = $('#set-uuid');
    el.setPbk = $('#set-pbk');
    el.setSid = $('#set-sid');
    el.setSni = $('#set-sni');
    el.setPort = $('#set-port');
    el.setTotal = $('#set-total');
    el.setExpire = $('#set-expire');
    el.themeMode = $('#theme-mode');
    el.appearanceNote = $('#appearance-note');
    el.settingsUpdated = $('#settings-updated');
    el.settingsSave = $('#settings-save');
    el.settingsSaveLabel = $('.btn-label', el.settingsSave);
    el.settingsSaveSpinner = $('.spinner', el.settingsSave);
    el.settingsGlobalError = $('#settings-global-error');
    el.settingsClear = $('#settings-clear');

    el.fieldUuid = $('#f-uuid');
    el.fieldTls = $('#f-tls');
    el.fieldReality = $('#f-reality');
    el.fieldPbk = $('#f-pbk');
    el.fieldSid = $('#f-sid');
    el.fieldSni = $('#f-sni');
    el.fieldFp = $('#f-fp');
    el.fieldFlow = $('#f-flow');
    el.fieldWsPath = $('#f-wspath');
    el.fieldWsHost = $('#f-wshost');
    el.fieldGrpc = $('#f-grpc');
    el.fieldUdp = $('#f-udp');
    el.networkBox = $('#f-network');

    el.vmUuid = $('#f-vm-uuid');
    el.vmNetworkBox = $('#f-vm-network');
    el.vmTls = $('#f-vm-tls');
    el.vmSni = $('#f-vm-sni');
    el.vmWsPath = $('#f-vm-wspath');
    el.vmWsHost = $('#f-vm-wshost');
    el.vmGrpc = $('#f-vm-grpc');
    el.vmUdp = $('#f-vm-udp');

    el.trPassword = $('#f-tr-password');
    el.trSni = $('#f-tr-sni');
    el.trSkip = $('#f-tr-skip');
    el.trUdp = $('#f-tr-udp');

    el.hyPassword = $('#f-hy-password');
    el.hySni = $('#f-hy-sni');
    el.hyUp = $('#f-hy-up');
    el.hyDown = $('#f-hy-down');
    el.hySkip = $('#f-hy-skip');

    el.ssCipher = $('#f-ss-cipher');
    el.ssPassword = $('#f-ss-password');
    el.ssUdp = $('#f-ss-udp');

    el.genericLayer = $('#generic-layer');
    el.genericIcon = $('#generic-icon');
    el.genericTitle = $('#generic-title');
    el.genericBody = $('#generic-body');
    el.genericOk = $('#generic-ok');
    el.nodesExport = $('#nodes-export');
    el.nodesImport = $('#nodes-import');
    el.importFile = $('#import-file');
    el.kvLayer = $('#kv-layer');
    el.kvCopyName = $('#kv-copy-name');
    el.linksLayer = $('#links-layer');
    el.linksTabs = $$('#links-layer .tab');
    el.linksPanels = $$('#links-layer .tab-panel');
    el.linksInput = $('#links-input');
    el.linksRegion = $('#links-region');
    el.linksSummary = $('#links-summary');
    el.linksFeedback = $('#links-feedback');
    el.linksPreview = $('#links-preview');
    el.linksExportCount = $('#links-export-count');
    el.linksExport = $('#links-export');
    el.linksDownload = $('#links-download');
    el.linksCopyAll = $('#links-copy-all');
    el.linksConfirm = $('#links-confirm');
    el.linksFootNote = $('#links-foot-note');
    el.toasts = $('#toasts');
    el.themeColor = $('meta[name="theme-color"]');
  }

  /* ------------------------------------------------------------------ */
  /* theme                                                               */
  /* ------------------------------------------------------------------ */

  function themeMode() {
    var saved = storageGet('local', THEME_KEY);
    return THEME_MODES.indexOf(saved) !== -1 ? saved : 'system';
  }

  function currentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function prefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function resolvedTheme(mode) {
    if (mode === 'light' || mode === 'dark') return mode;
    return prefersDark() ? 'dark' : 'light';
  }

  var THEME_NOTES = {
    system: '跟随系统外观，系统切换深色时控制台会同步变化。',
    light: '始终使用浅色外观，适合明亮的白天环境。',
    dark: '始终使用深色外观，适合夜间或长时间查看。'
  };

  function applyThemeUi() {
    var mode = themeMode();
    var dark = currentTheme() === 'dark';
    var href = dark ? '#i-sun' : '#i-moon';
    if (el.themeToggle) {
      var themeIcon = $('.theme-icon use', el.themeToggle);
      if (themeIcon) themeIcon.setAttribute('href', href);
      var themeLabel = $('.theme-label', el.themeToggle);
      if (themeLabel) themeLabel.textContent = dark ? '浅色模式' : '深色模式';
      el.themeToggle.setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到深色模式');
    }
    if (el.mobileTheme) {
      var mobileIcon = $('use', el.mobileTheme);
      if (mobileIcon) mobileIcon.setAttribute('href', href);
      el.mobileTheme.setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到深色模式');
    }
    if (el.themeColor) el.themeColor.setAttribute('content', dark ? '#070b13' : '#f4f5fa');
    if (el.themeMode) {
      $$('button[data-theme-mode]', el.themeMode).forEach(function (button) {
        var active = button.dataset.themeMode === mode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
    if (el.appearanceNote) el.appearanceNote.textContent = THEME_NOTES[mode];
  }

  function applyTheme(mode, persist) {
    var clean = THEME_MODES.indexOf(mode) !== -1 ? mode : 'system';
    document.documentElement.dataset.theme = resolvedTheme(clean);
    if (persist) storageSet('local', THEME_KEY, clean);
    applyThemeUi();
  }

  function setThemeMode(mode) {
    applyTheme(mode, true);
  }

  function toggleTheme() {
    setThemeMode(currentTheme() === 'dark' ? 'light' : 'dark');
  }

  /* ------------------------------------------------------------------ */
  /* auth                                                                */
  /* ------------------------------------------------------------------ */

  function setLoginBusy(busy) {
    var info = state.authInfo || {};
    // 两种情况下初始化按钮不可用：没绑 KV；以及实例默认拒绝开放初始化
    // 又没配 ADMIN_TOKEN（此时填什么都没用，必须先去配环境变量）
    var blocked = state.loginView === 'setup' && (info.kv === false || info.setupDisabled);
    el.loginBtn.disabled = busy || blocked;
    el.loginBtn.classList.toggle('is-loading', busy);
    el.loginSpinner.hidden = !busy;
    var labels = { login: '登录', setup: '创建管理员并进入', recovery: '使用恢复令牌' };
    el.loginLabel.textContent = busy
      ? (state.loginView === 'setup' ? '正在创建…' : '正在验证…')
      : (labels[state.loginView] || '登录');
  }

  function showLoginError(message) {
    el.loginError.textContent = message || '';
    el.loginError.hidden = !message;
  }

  async function publicRequest(path, options) {
    var opts = options || {};
    var headers = {};
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.token) headers.authorization = 'Bearer ' + opts.token;
    var response;
    try {
      response = await fetch(path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        cache: 'no-store'
      });
    } catch (err) {
      throw new ApiError('网络请求失败，请检查连接后重试', 0);
    }
    var data = await safeJson(response);
    if (!response.ok) {
      throw new ApiError(
        (data && data.error) || ('请求失败（HTTP ' + response.status + '）'),
        response.status,
        data,
        data && data.field
      );
    }
    return data || {};
  }

  function setRevealState(button, revealed, label) {
    var use = button ? $('use', button) : null;
    if (use) use.setAttribute('href', revealed ? '#i-eye-off' : '#i-eye');
    if (button) button.setAttribute('aria-label', (revealed ? '隐藏' : '显示') + (label || '内容'));
  }

  function renderAuthView(view) {
    state.loginView = view;
    var info = state.authInfo || {};
    var setup = view === 'setup';
    var recovery = view === 'recovery';
    showLoginError('');

    el.authEyebrow.textContent = setup ? 'First Run' : (recovery ? 'Recovery' : 'Admin Access');
    el.authTitle.textContent = setup ? '初始化控制台' : (recovery ? '恢复访问' : '登录控制台');
    el.authSub.textContent = setup
      ? '创建第一个管理员账号，用户名可使用邮箱，账号密码会保存在你的 KV 中。'
      : (recovery ? '使用部署时配置的 ADMIN_TOKEN 临时进入控制台。' : '使用用户名或邮箱登录，账号密码保存在你的 KV 中。');

    el.fieldUsername.hidden = recovery;
    el.fieldPassword.hidden = recovery;
    el.fieldConfirm.hidden = !setup;
    el.fieldToken.hidden = !recovery;
    el.fieldSetupToken.hidden = !(setup && info.setupLocked);
    el.loginRecovery.hidden = setup || !info.recovery;
    el.loginRecovery.textContent = recovery ? '返回账号登录' : '使用部署恢复令牌';
    el.loginPassword.setAttribute('autocomplete', setup ? 'new-password' : 'current-password');

    var note = $('span', el.loginNote);
    if (note) {
      note.textContent = setup
        ? '密码只保存为不可逆哈希，不会明文写入 KV。'
        : (recovery ? '恢复令牌来自环境变量 ADMIN_TOKEN，日常登录请使用账号密码。' : '登录状态仅保存在当前标签页，关闭浏览器后自动退出。');
    }

    if (setup) {
      if (!info.kv) {
        el.loginHelp.textContent = '尚未绑定 SUB_KV，无法保存管理员账号，请先完成 KV 绑定。';
      } else if (info.setupDisabled) {
        el.loginHelp.textContent = '为防止实例被任意访问者抢占，初始化前需先在 Worker 环境变量里配置 ADMIN_TOKEN（16 位以上随机字符串，建议写成 Secret），保存后刷新本页。确实要开放初始化，可设置 ALLOW_OPEN_SETUP=1。';
      } else if (info.setupLocked) {
        el.loginHelp.textContent = '该实例已配置 ADMIN_TOKEN，需填写恢复令牌才能完成初始化。';
      } else if (info.corrupted) {
        el.loginHelp.textContent = '检测到用户数据损坏，继续初始化会覆盖损坏的账号数据。';
      } else {
        el.loginHelp.textContent = '本实例允许开放初始化，任何访问者都能创建管理员，请完成初始化后立刻配置 ADMIN_TOKEN。';
      }
    } else if (recovery) {
      el.loginHelp.textContent = '恢复令牌用于忘记密码或恢复访问，不会取代日常账号登录。';
    } else {
      el.loginHelp.textContent = '忘记密码时，可由所有者重置；成员也可登录后在设置页自行修改。';
    }

    if (!recovery && !el.loginUsername.value) {
      el.loginUsername.value = storageGet('local', USERNAME_KEY) || '';
    }
    if (recovery) {
      el.loginPassword.value = '';
      el.loginPassword.type = 'password';
      el.loginConfirm.value = '';
      setRevealState(el.loginPasswordReveal, false, '密码');
    }
    if (!recovery) {
      el.loginToken.type = 'password';
      setRevealState(el.loginTokenReveal, false, '令牌');
    }
    if (!setup) {
      el.loginConfirm.value = '';
      el.loginSetupToken.value = '';
    }

    setLoginBusy(false);
    if (!el.authScreen.hidden) {
      var target = setup || !recovery ? el.loginUsername : el.loginToken;
      window.setTimeout(function () { target.focus({ preventScroll: true }); }, 40);
    }
  }

  function authErrorFocus(field) {
    if (field === 'username') el.loginUsername.focus();
    else if (field === 'password' || field === 'confirm') el.loginPassword.focus();
    else if (field === 'setupToken') el.loginSetupToken.focus();
    else if (state.loginView === 'recovery') el.loginToken.focus();
  }

  async function finishLogin(token, username) {
    state.token = token;
    var data = await request('/api/config');
    if (!data || !data.config || !Array.isArray(data.config.nodes)) {
      throw new ApiError('接口返回数据异常，请确认 Worker 版本是否正确', 0);
    }
    storageSet('session', STORAGE_KEY, token);
    storageSet('local', USERNAME_KEY, (data.meta && data.meta.username) || username || '');
    if (state.authInfo) state.authInfo.needsSetup = false;
    applyConfig(data);
    enterApp();
  }

  async function submitAuth(event) {
    if (event) event.preventDefault();
    if (state.loginView === 'recovery') return recoverWithToken();

    var setup = state.loginView === 'setup';
    var info = state.authInfo || {};
    var username = String(el.loginUsername.value || '').trim();
    var password = el.loginPassword.value || '';
    showLoginError('');

    if (!username) {
      showLoginError('请输入用户名或邮箱。');
      el.loginUsername.focus();
      return;
    }
    if (setup && !USERNAME_RE.test(username)) {
      showLoginError('用户名需为 3–254 位（字母、数字或 . _ + @ -），也可以直接填写邮箱地址。');
      el.loginUsername.focus();
      return;
    }
    if (!password) {
      showLoginError('请输入密码。');
      el.loginPassword.focus();
      return;
    }
    if (setup) {
      if (password.length < PASSWORD_MIN) {
        showLoginError('密码至少需要 ' + PASSWORD_MIN + ' 个字符。');
        el.loginPassword.focus();
        return;
      }
      if (password !== el.loginConfirm.value) {
        showLoginError('两次输入的密码不一致。');
        el.loginConfirm.focus();
        return;
      }
      if (info.setupDisabled) {
        showLoginError('该实例默认拒绝开放初始化，请先在环境变量中配置 ADMIN_TOKEN 后刷新本页。');
        return;
      }
      if (info.setupLocked && !String(el.loginSetupToken.value || '').trim()) {
        showLoginError('该实例已配置 ADMIN_TOKEN，请填写部署恢复令牌。');
        el.loginSetupToken.focus();
        return;
      }
    }

    setLoginBusy(true);
    try {
      var data;
      if (setup) {
        data = await publicRequest('/api/setup', {
          method: 'POST',
          token: String(el.loginSetupToken.value || '').trim() || undefined,
          body: { username: username, password: password }
        });
      } else {
        data = await publicRequest('/api/login', {
          method: 'POST',
          body: { username: username, password: password }
        });
      }
      if (!data || !data.token) throw new ApiError('登录响应异常，请稍后重试。', 0);
      await finishLogin(data.token, username);
    } catch (err) {
      state.token = '';
      storageRemove('session', STORAGE_KEY);
      if (err.status === 401) {
        showLoginError('用户名或密码不正确。');
        if (!setup) {
          el.loginPassword.focus();
          el.loginPassword.select();
        }
      } else if (err.status === 409 && setup) {
        await loadAuthInfo();
      } else if (err.status === 403 && err.data && err.data.needsSetup) {
        await loadAuthInfo();
      } else {
        showLoginError(err.message || '登录失败，请稍后重试。');
        authErrorFocus(err.field);
      }
    } finally {
      setLoginBusy(false);
    }
  }

  async function recoverWithToken() {
    var token = String(el.loginToken.value || '').trim();
    if (!token) {
      showLoginError('请输入部署恢复令牌。');
      el.loginToken.focus();
      return;
    }
    showLoginError('');
    setLoginBusy(true);
    state.token = token;
    try {
      var data = await request('/api/config');
      if (!data || !data.config || !Array.isArray(data.config.nodes)) {
        throw new ApiError('接口返回数据异常，请确认 Worker 版本是否正确', 0);
      }
      // 恢复令牌是长期有效、可直接接管全部账号的部署凭据，绝不写进 storage：
      // 刷新页面即退出恢复会话，避免被浏览器扩展 / 残留脚本长期读取
      storageRemove('session', STORAGE_KEY);
      applyConfig(data);
      enterApp();
    } catch (err) {
      state.token = '';
      storageRemove('session', STORAGE_KEY);
      if (err.status === 401) showLoginError('恢复令牌无效。');
      else showLoginError(err.message || '恢复失败，请稍后重试。');
      el.loginToken.focus();
      el.loginToken.select();
    } finally {
      setLoginBusy(false);
    }
  }

  async function loadAuthInfo() {
    var info;
    try {
      info = await publicRequest('/api/auth');
    } catch (err) {
      state.authInfo = null;
      renderAuthView('login');
      showLoginError(err.message || '无法连接 Worker，请稍后刷新重试。');
      return null;
    }
    state.authInfo = info;
    renderAuthView(info.needsSetup ? 'setup' : 'login');
    return info;
  }

  async function initAuth() {
    setLoginBusy(true);
    var info = await loadAuthInfo();
    if (!info) return;

    var saved = storageGet('session', STORAGE_KEY);
    if (!saved) return;
    state.token = saved;
    try {
      var data = await request('/api/config');
      if (!data || !data.config || !Array.isArray(data.config.nodes)) {
        throw new ApiError('接口返回数据异常，请确认 Worker 版本是否正确', 0);
      }
      applyConfig(data);
      enterApp();
    } catch (err) {
      state.token = '';
      storageRemove('session', STORAGE_KEY);
      if (err.status && err.status !== 401) {
        showLoginError(err.message || '载入配置失败，请稍后重试。');
      }
      setLoginBusy(false);
    }
  }

  function enterApp() {
    el.authScreen.hidden = true;
    el.app.hidden = false;
    state.users = null;
    state.usersRev = 0;
    state.usersLoading = false;
    state.currentUserId = (state.meta && state.meta.userId) || null;
    state.view = 'overview';
    syncRoleUi();
    resetFilters();
    renderAll();
    switchView('overview');
  }

  function logout(message) {
    state.token = '';
    state.config = null;
    state.meta = null;
    state.rev = 0;
    state.users = null;
    state.usersRev = 0;
    state.currentUserId = null;
    state.usersLoading = false;
    state.userBusy = false;
    state.preview = '';
    state.previewDirty = true;
    state.previewPromise = null;
    state.previewLoading = false;
    state.subRevealed = false;
    state.mutating = false;
    state.query = '';
    state.filterType = 'all';
    state.filterRegion = 'all';
    state.editingId = null;
    state.deletingId = null;
    state.selected.clear();
    state.selectionAnchorId = null;
    state.menuNodeId = null;
    state.menuTrigger = null;
    state.linksParsed = [];
    state.linksErrors = [];
    state.linksExportText = '';
    state.linksTab = 'import';
    state.previewQuery = '';
    state.previewHits = [];
    state.previewHitIndex = -1;
    window.clearTimeout(state.previewSearchTimer);
    window.clearTimeout(state.linksTimer);
    storageRemove('session', STORAGE_KEY);
    closeRowMenu(true);
    closeDrawer(true);
    closeModal('generic', true);
    closeModal('kv', true);
    closeModal('links', true);
    closeUserEditor();
    if (el.userList) el.userList.innerHTML = '';
    if (el.previewSearch) el.previewSearch.value = '';
    if (el.linksInput) el.linksInput.value = '';
    if (el.setAuthToken) el.setAuthToken.value = '';
    el.app.hidden = true;
    el.authScreen.hidden = false;
    el.loginUsername.value = storageGet('local', USERNAME_KEY) || '';
    el.loginPassword.value = '';
    el.loginConfirm.value = '';
    el.loginSetupToken.value = '';
    el.loginToken.value = '';
    el.loginPassword.type = 'password';
    el.loginToken.type = 'password';
    setRevealState(el.loginPasswordReveal, false, '密码');
    setRevealState(el.loginTokenReveal, false, '令牌');
    var view = state.authInfo && state.authInfo.needsSetup ? 'setup' : 'login';
    renderAuthView(view);
    showLoginError(message || '');
    el.subUrlText.textContent = '—';
    el.previewSubUrl.textContent = '—';
    el.yamlCode.innerHTML = '';
    el.codeLines.textContent = '0 行';
    el.codeSize.textContent = '0 KB';
    el.nodeList.innerHTML = '';
    document.body.classList.remove('has-bulk');
    document.body.classList.remove('is-member');
    window.setTimeout(function () { el.loginUsername.focus(); }, 60);
  }

  function handleUnauthorized() {
    logout('登录已失效，请重新登录。');
  }

  function applyConfig(data) {
    state.config = data.config;
    state.rev = Number(data.config.rev) || 0;
    state.meta = data.meta || {};
    state.currentUserId = state.meta.userId || state.currentUserId;
    state.previewDirty = true;
  }

  /* ------------------------------------------------------------------ */
  /* rendering                                                           */
  /* ------------------------------------------------------------------ */

  function nodes() {
    return state.config && Array.isArray(state.config.nodes) ? state.config.nodes : [];
  }

  function enabledNodes() {
    return nodes().filter(function (node) { return node.enabled; });
  }

  function renderAll() {
    renderChrome();
    renderOverview();
    renderNodeList();
    renderSubUrls();
    renderPreviewGroups();
  }

  function renderChrome() {
    var meta = state.meta || {};
    var enabled = enabledNodes();
    var total = nodes().length;

    el.navCount.textContent = String(total);
    el.modePill.classList.add('is-warning');
    if (!isOwner() && (!meta.kv || meta.readonly || meta.corrupted)) {
      el.modePillText.textContent = (!meta.kv || meta.readonly) ? '只读模式' : '配置异常';
    } else if (!isOwner()) {
      el.modePill.classList.remove('is-warning');
      el.modePillText.textContent = '成员 · ' + personalNodes().length + ' 个人节点';
    } else if (!meta.kv || meta.readonly) {
      el.modePillText.textContent = '只读模式';
    } else if (meta.corrupted) {
      el.modePillText.textContent = '配置异常';
    } else {
      el.modePill.classList.remove('is-warning');
      el.modePillText.textContent = enabled.length + ' 节点在线';
    }

    var kvMissing = !meta.kv || meta.readonly;
    el.storageDot.classList.toggle('is-warning', kvMissing || !!meta.corrupted);
    el.storageLabel.textContent = kvMissing ? '只读模式' : (meta.corrupted ? '配置异常' : 'KV 已连接');
    el.storageHint.textContent = kvMissing ? '点击查看 KV 绑定步骤' : '配置已持久化';
    el.kvAlert.hidden = !kvMissing;
    el.corruptAlert.hidden = !meta.corrupted;
    el.tokenAlert.hidden = !!meta.hasAuthToken;
    el.emptySubAlert.hidden = !(total > 0 && enabled.length === 0);
    el.heroNodeCount.textContent = String(enabled.length);
    el.heroStatusText.textContent = !isOwner()
      ? '成员访问 · 共享节点 + 个人节点'
      : (kvMissing ? '只读预览 · 尚未连接存储' : (meta.corrupted ? '配置异常 · 当前载入默认节点' : '订阅服务运行中'));
    if (el.heroVersion) el.heroVersion.textContent = 'v' + (meta.version || '2.0.0');

    var personalCount = personalNodes().length;
    if (!isOwner()) {
      if (!total) {
        el.heroTitle.innerHTML = '还没有可用节点，<br class="hero-br">先添加一条自己的线路。';
        el.heroDesc.textContent = '你添加的节点只保存在自己的账号下，不影响所有人的共享配置。';
      } else if (!enabled.length) {
        el.heroTitle.innerHTML = '所有节点已停用，<br class="hero-br">订阅暂时为空。';
        el.heroDesc.textContent = '启用自己的节点，或联系所有者启用共享节点；客户端刷新订阅后才会拿到新配置。';
      } else {
        el.heroTitle.innerHTML = '节点已就绪，随时同步<br class="hero-br">至你的每一台设备。';
        el.heroDesc.textContent = personalCount
          ? '其中 ' + personalCount + ' 个是你自己的节点，修改只影响当前账号；共享节点由所有者维护。'
          : '共享节点由所有者维护；点击「添加节点」可以创建只对自己生效的线路。';
      }
    } else if (!total) {
      el.heroTitle.innerHTML = '还没有节点，<br class="hero-br">从第一条线路开始。';
      el.heroDesc.textContent = '添加节点后，这里会自动生成订阅链接与 Clash 配置，所有数据都保存在你自己的 KV 中。';
    } else if (!enabled.length) {
      el.heroTitle.innerHTML = '所有节点已停用，<br class="hero-br">订阅暂时为空。';
      el.heroDesc.textContent = '客户端刷新订阅后只会拿到空配置。启用至少一个节点，或调整筛选后继续维护。';
    } else {
      el.heroTitle.innerHTML = '节点已就绪，随时同步<br class="hero-br">至你的每一台设备。';
      el.heroDesc.textContent = '编辑节点或调整分组后无需重新部署，客户端下次刷新订阅即可获取最新配置。';
    }
  }

  /* 控制台 CSP 是 style-src 'nonce-…'，内联 style 属性会被浏览器直接丢弃
     （nonce 只覆盖 <style> 元素，不覆盖 style 属性）。宽度与色块因此改用
     CSSOM 赋值：element.style 不受 CSP 限制，既保住 nonce-only 策略，
     又不会让统计条全部渲染成 100%。 */
  function applyBarStyles(root) {
    if (!root) return;
    $$('[data-pct]', root).forEach(function (bar) {
      var pct = Number(bar.getAttribute('data-pct'));
      if (!isFinite(pct)) pct = 0;
      bar.style.width = pct + '%';
      bar.classList.toggle('is-zero', pct <= 0);
    });
    $$('[data-color]', root).forEach(function (dot) {
      var color = dot.getAttribute('data-color');
      if (color) dot.style.background = color;
    });
  }

  function renderOverview() {
    if (!state.config) return;
    var list = nodes();
    var enabled = enabledNodes();
    var meta = state.meta || {};
    var typeCounts = {};
    TYPE_ORDER.forEach(function (type) { typeCounts[type] = 0; });
    enabled.forEach(function (node) {
      if (typeCounts[node.type] !== undefined) typeCounts[node.type] += 1;
    });
    var activeTypes = TYPE_ORDER.filter(function (type) { return typeCounts[type] > 0; });
    var regionCounts = {};
    enabled.forEach(function (node) {
      var region = REGION_META[node.region] ? node.region : 'other';
      regionCounts[region] = (regionCounts[region] || 0) + 1;
    });
    var regionBuckets = REGION_ORDER.filter(function (key) {
      return key !== 'other' && regionCounts[key];
    });
    var activeGroups = 1 + regionBuckets.length + 4;

    el.statTotal.textContent = String(list.length);
    el.statEnabled.textContent = String(enabled.length);
    el.statTypes.textContent = String(activeTypes.length);
    el.statRegions.textContent = String(activeGroups);
    el.statEnabledBadge.textContent = list.length
      ? Math.round((enabled.length / list.length) * 100) + '%'
      : '在线';
    el.statTypesHint.textContent = '协议';

    el.overviewUpdated.textContent = state.config.updatedAt
      ? '更新于 ' + formatShort(state.config.updatedAt)
      : '尚未写入配置';

    if (!enabled.length) {
      el.protoBars.innerHTML = '<div class="bar-empty">还没有启用的节点</div>';
    } else {
      el.protoBars.innerHTML = TYPE_ORDER.map(function (type) {
        var count = typeCounts[type] || 0;
        var percent = Math.round((count / enabled.length) * 100);
        return '<div class="bar-row">' +
          '<span class="bar-label"><span class="type-dot" data-color="' + esc(TYPE_META[type].color) + '"></span><b>' + TYPE_META[type].label + '</b></span>' +
          '<span class="bar-track"><span class="bar-fill fill-' + type + '" data-pct="' + percent + '"></span></span>' +
          '<span class="bar-count">' + count + '</span>' +
          '</div>';
      }).join('');
      applyBarStyles(el.protoBars);
    }
    el.protoTotal.textContent = enabled.length + ' 在线';

    var regionRows = REGION_ORDER.filter(function (key) {
      return key !== 'other' || regionCounts.other;
    }).filter(function (key) {
      return regionCounts[key];
    });
    if (!regionRows.length) {
      el.regionBars.innerHTML = '<div class="bar-empty">暂无分组数据</div>';
    } else {
      el.regionBars.innerHTML = regionRows.map(function (key) {
        var count = regionCounts[key] || 0;
        var percent = Math.round((count / enabled.length) * 100);
        var region = REGION_META[key];
        return '<div class="bar-row">' +
          '<span class="bar-label"><span class="type-dot" data-color="' + esc(regionColor(key)) + '"></span><b>' + esc(region.group) + '</b></span>' +
          '<span class="bar-track"><span class="bar-fill fill-' + key + '" data-pct="' + percent + '"></span></span>' +
          '<span class="bar-count">' + count + '</span>' +
          '</div>';
      }).join('');
      applyBarStyles(el.regionBars);
    }

    var recent = enabled.concat(list.filter(function (node) { return !node.enabled; })).slice(0, 4);
    if (!recent.length) {
      el.recentNodes.innerHTML = '<div class="bar-empty">暂无节点</div>';
    } else {
      el.recentNodes.innerHTML = recent.map(function (node) {
        var region = REGION_META[node.region] || REGION_META.other;
        var type = TYPE_META[node.type] || { label: node.type };
        var disabled = node.enabled ? '' : ' <span class="mini-badge">停用</span>';
        var inner = '<span class="mini-avatar avatar-' + esc(node.region) + '">' + region.flag + '</span>' +
          '<span class="mini-main"><span class="mini-name">' + esc(node.name) + disabled + '</span>' +
          '<span class="mini-sub">' + esc(node.server) + ':' + esc(node.port) + '</span></span>' +
          '<span class="type-badge t-' + esc(node.type) + '"><span class="dot"></span>' + esc(type.label) + '</span>';
        // 只有能改的节点才渲染成按钮；共享节点保持只读展示
        return editableNode(node)
          ? '<button class="mini-item" type="button" data-edit-id="' + esc(node.id) + '">' + inner + '</button>'
          : '<div class="mini-item">' + inner + '</div>';
      }).join('');
    }

    var kvMissing = !meta.kv || meta.readonly;
    el.sysKv.textContent = kvMissing ? '未绑定 · 只读' : '已连接';
    el.sysKv.className = 'kv-val ' + (kvMissing ? 'is-warning' : 'is-ok');
    el.sysAuth.textContent = meta.authType === 'recovery'
      ? '恢复令牌会话'
      : (meta.username ? (isOwner() ? '所有者 · ' : '成员 · ') + meta.username : '账号登录');
    if (el.overviewAuthNote) {
      el.overviewAuthNote.textContent = isOwner()
        ? '登录使用账号密码，可在左侧「用户管理」添加或重置用户；订阅令牌只用于订阅链接。'
        : '成员账号可添加和修改自己的节点；共享节点与订阅链接由所有者分配。';
    }
    el.sysRev.textContent = '#' + state.rev;
    el.sysUpdated.textContent = state.config.updatedAt ? formatFull(state.config.updatedAt) : '尚未保存';

    var healthy = !kvMissing && !meta.corrupted;
    el.sysHealth.textContent = meta.corrupted ? '需注意' : (kvMissing ? '只读' : '正常');
    el.sysHealth.classList.toggle('soft-ok', healthy);

    renderSubUrls();
  }

  function regionColor(key) {
    var colors = { us: '#4f46e5', jp: '#db2777', hk: '#0891b2', relay: '#d97706', other: '#64748b' };
    return colors[key] || colors.other;
  }

  function maskToken(url) {
    if (!url) return '';
    return url.replace(/([?&]token=)[^&#]*/, function (match, prefix) {
      return prefix + '••••••••';
    });
  }

  function subUrlValue() {
    if (!state.meta || !state.meta.subUrl) return '';
    return state.meta.subUrl;
  }

  function renderSubUrls() {
    var url = subUrlValue();
    var display = url
      ? (state.subRevealed ? url : maskToken(url))
      : '尚未配置订阅令牌，请前往设置';
    if (el.subUrlText) el.subUrlText.textContent = display;
    if (el.previewSubUrl) el.previewSubUrl.textContent = display;
    if (el.subReveal) {
      var use = $('use', el.subReveal);
      if (use) use.setAttribute('href', state.subRevealed ? '#i-eye-off' : '#i-eye');
      el.subReveal.setAttribute('aria-label', state.subRevealed ? '隐藏令牌' : '显示令牌');
      el.subReveal.title = state.subRevealed ? '隐藏令牌' : '显示令牌';
      el.subReveal.disabled = !url;
    }
    if (el.subCopy) el.subCopy.disabled = !url;
    if (el.previewCopySub) el.previewCopySub.disabled = !url;
  }

  var GROUP_REGIONS = ['us', 'jp', 'hk', 'relay'];

  function isGroupRegion(region) {
    return GROUP_REGIONS.indexOf(region) !== -1;
  }

  // 某分组的节点 id 顺序：独立顺序表优先，未收录的按全局顺序追加
  function orderedRegionIds(region) {
    var stored = ((state.config && state.config.regionOrder) || {})[region] || [];
    var ids = nodes()
      .filter(function (node) { return node.region === region; })
      .map(function (node) { return node.id; });
    var seen = {};
    var out = [];
    stored.forEach(function (id) {
      if (ids.indexOf(id) !== -1 && !seen[id]) {
        seen[id] = true;
        out.push(id);
      }
    });
    ids.forEach(function (id) {
      if (!seen[id]) {
        seen[id] = true;
        out.push(id);
      }
    });
    return out;
  }

  function filteredNodes() {
    var all = nodes();
    var query = state.query.trim().toLowerCase();
    return all.filter(function (node) {
      if (state.filterType !== 'all' && node.type !== state.filterType) return false;
      if (state.filterRegion !== 'all' && node.region !== state.filterRegion) return false;
      if (!query) return true;
      var type = TYPE_META[node.type] || { label: node.type };
      var region = REGION_META[node.region] || REGION_META.other;
      var tagText = (node.tags || []).map(function (tag) {
        return TAG_META[tag] ? TAG_META[tag].label : tag;
      }).join(' ');
      var haystack = [node.name, node.server, node.type, type.label, region.short, region.group, tagText].join(' ').toLowerCase();
      return haystack.indexOf(query) !== -1;
    });
  }

  // 当前列表视图：筛选 +（按分组筛选时）该分组的独立顺序。
  // 列表渲染与排序移动必须共用同一顺序，否则换错邻居导致乱序。
  function viewNodes() {
    var list = filteredNodes();
    if (!state.query.trim() && isGroupRegion(state.filterRegion)) {
      var rank = {};
      orderedRegionIds(state.filterRegion).forEach(function (id, i) { rank[id] = i; });
      var far = 1e9;
      list.sort(function (a, b) {
        var ra = rank[a.id] === undefined ? far : rank[a.id];
        var rb = rank[b.id] === undefined ? far : rank[b.id];
        return ra - rb;
      });
    }
    return list;
  }

  function renderNodeList() {
    if (!state.config) return;
    closeRowMenu(true, false);
    var known = {};
    nodes().forEach(function (node) { known[node.id] = true; });
    Array.from(state.selected).forEach(function (id) {
      if (!known[id]) state.selected.delete(id);
    });

    var all = nodes();
    var query = state.query.trim().toLowerCase();
    var filtered = viewNodes();

    el.nodeCountLabel.textContent = query || state.filterType !== 'all' || state.filterRegion !== 'all'
      ? filtered.length + ' / ' + all.length + ' 个节点'
      : '共 ' + all.length + ' 个节点';

    el.nodeHead.hidden = all.length === 0;
    el.nodeEmpty.hidden = all.length !== 0;
    el.nodeEmptyFilter.hidden = !(all.length > 0 && filtered.length === 0);
    el.nodeList.hidden = filtered.length === 0;

    var sortable = !query;
    el.nodeList.innerHTML = filtered.map(function (node, index) {
      return renderNodeRow(node, index, filtered.length, sortable);
    }).join('');
    syncSelectionUi();
  }

  function renderNodeRow(node, index, total, sortable) {
    var region = REGION_META[node.region] || REGION_META.other;
    var type = TYPE_META[node.type] || { label: node.type };
    var tags = (node.tags || []).filter(function (tag) { return TAG_META[tag]; });
    var tagHtml = tags.length
      ? '<div class="node-sub">' + tags.map(function (tag) {
        return '<span class="app-chip" title="' + esc(TAG_META[tag].label) + '">' + TAG_META[tag].emoji + '</span>';
      }).join('') + '</div>'
      : '';

    var shared = isSharedNode(node);
    var personal = !isOwner() && !shared;

    var badges = '';
    if (!node.enabled) badges += '<span class="mini-badge">已停用</span>';
    if (node.showInMain === false) badges += '<span class="mini-badge" title="不在「选择节点」中显示">不入主组</span>';
    if (personal) badges += '<span class="mini-badge is-personal" title="仅当前账号可见">我的</span>';
    if (shared) badges += '<span class="mini-badge" title="由所有者分配，成员不能修改">共享</span>';

    var moveHtml = '';
    if (sortable && isOwner()) {
      moveHtml =
        '<button class="icon-btn move-btn" type="button" data-move-id="' + esc(node.id) + '" data-dir="-1" title="上移" aria-label="上移节点"' + (index === 0 ? ' disabled' : '') + '>' + icon('arrow-up') + '</button>' +
        '<button class="icon-btn move-btn" type="button" data-move-id="' + esc(node.id) + '" data-dir="1" title="下移" aria-label="下移节点"' + (index === total - 1 ? ' disabled' : '') + '>' + icon('arrow-down') + '</button>';
    }

    var checked = state.selected.has(node.id);
    var rowClass = 'node-row' + (node.enabled ? '' : ' is-disabled') + (checked ? ' is-selected' : '') +
      (shared ? ' is-shared' : '') + (personal ? ' is-personal' : '');
    var rowAttrs = shared
      ? ''
      : ' tabindex="0" role="button" aria-label="编辑节点 ' + esc(node.name) + '"';
    var statusHtml = shared
      ? '<span class="shared-lock" title="共享节点由所有者维护" aria-label="共享节点由所有者维护">' + icon('shield') + '</span>'
      : '<button class="switch" type="button" role="switch" data-toggle-id="' + esc(node.id) + '" aria-checked="' + (node.enabled ? 'true' : 'false') + '" aria-label="' + (node.enabled ? '停用节点' : '启用节点') + '"></button>';
    var actionsHtml = shared
      ? ''
      : moveHtml +
        '<button class="icon-btn" type="button" data-edit-id="' + esc(node.id) + '" title="编辑" aria-label="编辑节点">' + icon('pen') + '</button>' +
        '<button class="icon-btn" type="button" data-menu-id="' + esc(node.id) + '" title="更多操作" aria-label="更多操作" aria-haspopup="menu" aria-expanded="false">' + icon('more') + '</button>';

    return '<div class="' + rowClass + '" data-id="' + esc(node.id) + '"' + rowAttrs + '>' +
      '<div class="cell cell-check"><input type="checkbox" class="check-input" data-pick-id="' + esc(node.id) + '" aria-label="选择节点 ' + esc(node.name) + '"' + (checked ? ' checked' : '') + '></div>' +
      '<div class="cell cell-node">' +
        '<span class="node-avatar avatar-' + esc(node.region) + '">' + region.flag + '</span>' +
        '<div class="node-main">' +
          '<div class="node-name"><span>' + esc(node.name) + '</span>' + badges + '</div>' +
          tagHtml +
        '</div>' +
      '</div>' +
      '<div class="cell cell-server">' +
        '<code>' + esc(node.server) + '</code><span class="port">:' + esc(node.port) + '</span>' +
      '</div>' +
      '<div class="cell cell-type"><span class="type-badge t-' + esc(node.type) + '"><span class="dot"></span>' + esc(type.label) + '</span></div>' +
      '<div class="cell cell-region"><span class="region-chip">' + region.flag + ' ' + esc(region.short) + '</span></div>' +
      '<div class="cell cell-status">' + statusHtml + '</div>' +
      '<div class="cell cell-actions">' + actionsHtml + '</div>' +
    '</div>';
  }

  /* ---- selection & bulk actions ---- */

  function isOwner() {
    // 旧版本 Worker 的 meta 没有 role，按原有行为视为所有者
    return !!(state.meta && state.meta.role !== 'member');
  }

  function canWrite() {
    var meta = state.meta;
    return !!(meta && meta.kv && !meta.readonly && meta.canWrite !== false);
  }

  function personalNodeIds() {
    var ids = state.meta && state.meta.personalNodeIds;
    return Array.isArray(ids) ? ids : [];
  }

  function isPersonalNode(node) {
    if (!node) return false;
    if (isOwner()) return true;
    return personalNodeIds().indexOf(node.id) !== -1;
  }

  function isSharedNode(node) {
    return !isOwner() && !!node && !isPersonalNode(node);
  }

  function editableNode(node) {
    return !!node && canWrite() && (isOwner() || isPersonalNode(node));
  }

  function personalNodes() {
    return nodes().filter(isPersonalNode);
  }

  function nodeLimit() {
    if (isOwner()) return MAX_NODES;
    var max = state.meta && Number(state.meta.maxPersonalNodes);
    return Number.isFinite(max) && max > 0 ? max : MAX_PERSONAL_NODES;
  }

  function personalRoom() {
    return Math.max(nodeLimit() - personalNodes().length, 0);
  }

  function clearSelection() {
    if (!state.selected.size && !state.selectionAnchorId) return;
    state.selected.clear();
    state.selectionAnchorId = null;
    syncSelectionUi();
  }

  function syncSelectionUi() {
    if (!el.nodeList) return;
    var visible = viewNodes();
    var visibleSelected = 0;
    $$('.node-row', el.nodeList).forEach(function (row) {
      var on = state.selected.has(row.dataset.id);
      if (on) visibleSelected += 1;
      row.classList.toggle('is-selected', on);
      var checkbox = $('.check-input', row);
      if (checkbox) checkbox.checked = on;
    });
    if (el.selectAll) {
      el.selectAll.checked = visible.length > 0 && visibleSelected === visible.length;
      el.selectAll.indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
      el.selectAll.disabled = visible.length === 0;
    }
    if (el.bulkBar) {
      var count = state.selected.size;
      el.bulkBar.hidden = count === 0 || state.view !== 'nodes' || el.app.hidden;
      if (count) el.bulkCount.textContent = String(count);
      document.body.classList.toggle('has-bulk', count > 0 && state.view === 'nodes' && !el.app.hidden);
    }
  }

  function toggleSelection(id, checked, shiftKey) {
    var visible = viewNodes();
    var index = visible.findIndex(function (node) { return node.id === id; });
    if (index === -1) return;
    if (shiftKey && state.selectionAnchorId) {
      var anchor = visible.findIndex(function (node) { return node.id === state.selectionAnchorId; });
      if (anchor !== -1) {
        var start = Math.min(anchor, index);
        var end = Math.max(anchor, index);
        for (var i = start; i <= end; i++) {
          if (checked) state.selected.add(visible[i].id);
          else state.selected.delete(visible[i].id);
        }
        syncSelectionUi();
        return;
      }
    }
    if (checked) state.selected.add(id);
    else state.selected.delete(id);
    state.selectionAnchorId = id;
    syncSelectionUi();
  }

  function selectAllVisible(checked) {
    viewNodes().forEach(function (node) {
      if (checked) state.selected.add(node.id);
      else state.selected.delete(node.id);
    });
    state.selectionAnchorId = null;
    syncSelectionUi();
  }

  function setBulkBusy(busy) {
    if (!el.bulkBar) return;
    el.bulkBar.classList.toggle('is-busy', busy);
    $$('button, select', el.bulkBar).forEach(function (control) {
      control.disabled = busy;
    });
  }

  function undoSnapshot(snapshot, message) {
    if (!ensureWritable() || state.mutating) return;
    saveNodes(snapshot, {
      successMessage: message || '已撤销上一步操作',
      rerenderOnError: true
    });
  }

  function bulkSetEnabled(nextEnabled) {
    if (!ensureWritable() || state.mutating) return;
    var ids = Array.from(state.selected);
    if (!ids.length) return;
    var previous = nodes();
    var next = previous.map(function (node) {
      return state.selected.has(node.id) ? Object.assign({}, node, { enabled: nextEnabled }) : node;
    });
    setBulkBusy(true);
    saveNodes(next, {
      successMessage: '已' + (nextEnabled ? '启用' : '停用') + ' ' + ids.length + ' 个节点',
      successAction: {
        label: '撤销',
        run: function () { undoSnapshot(previous, '已恢复上一步的启用状态'); }
      },
      rerenderOnError: true
    }).then(function (ok) {
      setBulkBusy(false);
      if (ok) clearSelection();
    });
  }

  function bulkMoveRegion() {
    if (!ensureWritable() || state.mutating) return;
    var region = el.bulkRegion.value;
    if (!region) return;
    var ids = Array.from(state.selected);
    if (!ids.length) return;
    var meta = REGION_META[region] || REGION_META.other;
    var previous = nodes();
    var next = previous.map(function (node) {
      return state.selected.has(node.id) ? Object.assign({}, node, { region: region }) : node;
    });
    setBulkBusy(true);
    saveNodes(next, {
      successMessage: '已将 ' + ids.length + ' 个节点移至「' + meta.group + '」',
      successAction: {
        label: '撤销',
        run: function () { undoSnapshot(previous, '已恢复节点原分组'); }
      },
      rerenderOnError: true
    }).then(function (ok) {
      setBulkBusy(false);
      // 失败时保留下拉选择，方便用户直接重试
      if (ok) {
        el.bulkRegion.value = '';
        clearSelection();
      }
    });
  }

  function askBulkDelete() {
    if (!ensureWritable()) return;
    var ids = Array.from(state.selected);
    if (!ids.length) return;
    openConfirm({
      title: '删除选中的 ' + ids.length + ' 个节点？',
      segments: [
        { text: '这些节点会立即从订阅中移除，删除后仍可在右下角提示中' },
        { strong: true, text: '撤销' },
        { text: '。' }
      ],
      okLabel: '删除 ' + ids.length + ' 个节点',
      danger: true,
      onOk: confirmBulkDelete
    });
  }

  async function confirmBulkDelete() {
    if (state.mutating) return;
    var ids = Array.from(state.selected);
    if (!ids.length) {
      closeModal('generic');
      return;
    }
    var previous = nodes();
    var next = previous.filter(function (node) { return !state.selected.has(node.id); });
    el.genericOk.disabled = true;
    el.genericOk.textContent = '删除中…';
    var ok = await saveNodes(next, {
      successMessage: '已删除 ' + ids.length + ' 个节点',
      successAction: {
        label: '撤销',
        run: function () { undoSnapshot(previous, '已恢复被删除的节点'); }
      },
      rerenderOnError: true
    });
    el.genericOk.disabled = false;
    el.genericOk.textContent = '删除 ' + ids.length + ' 个节点';
    if (ok) {
      clearSelection();
      closeModal('generic');
    }
  }

  /* ---- row action menu ---- */

  function closeRowMenu(immediate, restoreFocus) {
    if (!el.rowMenu || el.rowMenu.hidden) {
      state.menuNodeId = null;
      state.menuTrigger = null;
      return;
    }
    var trigger = state.menuTrigger;
    el.rowMenu.hidden = true;
    el.rowMenu.classList.remove('is-open');
    state.menuNodeId = null;
    state.menuTrigger = null;
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus !== false) trigger.focus({ preventScroll: true });
    }
  }

  function openRowMenu(id, trigger) {
    var node = findNode(id);
    if (!node || !el.rowMenu || !editableNode(node)) return;
    closeRowMenu(true, false);
    state.menuNodeId = id;
    state.menuTrigger = trigger;
    $$('[data-menu="duplicate"], [data-menu="delete"]', el.rowMenu).forEach(function (item) {
      item.disabled = !canWrite();
    });
    el.rowMenu.hidden = false;
    el.rowMenu.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');

    var rect = trigger.getBoundingClientRect();
    var menuRect = el.rowMenu.getBoundingClientRect();
    var left = rect.right - menuRect.width;
    left = Math.max(12, Math.min(left, window.innerWidth - menuRect.width - 12));
    var top = rect.bottom + 6;
    if (top + menuRect.height > window.innerHeight - 12) {
      top = rect.top - menuRect.height - 6;
    }
    el.rowMenu.style.left = left + 'px';
    el.rowMenu.style.top = Math.max(12, top) + 'px';

    var first = $('.menu-item:not([disabled])', el.rowMenu);
    if (first) window.setTimeout(function () { first.focus({ preventScroll: true }); }, 20);
  }

  function performRowMenu(action) {
    var id = state.menuNodeId;
    if (!id) return;
    var node = findNode(id);
    closeRowMenu(true, true);
    if (!node) return;
    if (action === 'share') copyShareLink(node);
    else if (action === 'server') copyText(node.server, '服务器地址已复制');
    else if (action === 'duplicate') duplicateNode(id);
    else if (action === 'delete') askDelete(id);
  }

  async function moveNode(id, dir, button) {
    if (!isOwner() || !ensureWritable() || state.mutating) return;
    var view = viewNodes();
    var viewIndex = view.findIndex(function (node) { return node.id === id; });
    var viewTarget = viewIndex + dir;
    if (viewIndex < 0 || viewTarget < 0 || viewTarget >= view.length) return;
    setRowBusy(button, true);

    // 按分组筛选时：只改该分组的独立顺序表，不动全局顺序，其他分组与 🌍组不受影响
    if (isGroupRegion(state.filterRegion)) {
      var order = orderedRegionIds(state.filterRegion);
      var idA = view[viewIndex].id;
      var idB = view[viewTarget].id;
      var pa = order.indexOf(idA);
      var pb = order.indexOf(idB);
      if (pa < 0 || pb < 0) {
        if (button) button.disabled = false;
        return;
      }
      var tmp = order[pa];
      order[pa] = order[pb];
      order[pb] = tmp;
      var regionOrder = Object.assign({}, (state.config && state.config.regionOrder) || {});
      regionOrder[state.filterRegion] = order;
      var okGroup = await saveNodes(nodes(), {
        regionOrder: regionOrder,
        successMessage: '分组内顺序已更新，不影响其他分组',
        rerenderOnError: true
      });
      if (!okGroup && button) button.disabled = false;
      return;
    }

    // 未筛选：视图中相邻即全局相邻，等价于交换；
    // 按协议筛选：视图中相邻的节点在全局数组里可能隔着其他协议的节点，
    // 直接交换会把中间的节点一起牵连进来。改为「移出后插入到目标旁」，
    // 筛选视图结果一致，且不影响协议筛选之外的节点。
    var nextNodes = nodes().slice();
    var a = nextNodes.findIndex(function (node) { return node.id === view[viewIndex].id; });
    var b = nextNodes.findIndex(function (node) { return node.id === view[viewTarget].id; });
    if (a < 0 || b < 0) {
      if (button) button.disabled = false;
      return;
    }
    var moved = nextNodes.splice(a, 1)[0];
    if (a < b) b -= 1; // 移出的节点在目标之前时，目标索引左移一位
    nextNodes.splice(dir < 0 ? b : b + 1, 0, moved);
    var ok = await saveNodes(nextNodes, {
      successMessage: dir < 0 ? '节点已上移' : '节点已下移',
      rerenderOnError: true
    });
    if (!ok && button) button.disabled = false;
  }

  function switchView(view) {
    if (!VIEW_META[view]) view = 'overview';
    if (view === 'users' && !isOwner()) view = 'overview';
    state.view = view;
    el.navItems.forEach(function (button) {
      var active = button.dataset.view === view;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    el.views.forEach(function (panel) {
      panel.hidden = panel.dataset.viewPanel !== view;
    });
    el.crumb.textContent = VIEW_META[view];
    if (el.bulkBar) el.bulkBar.hidden = view !== 'nodes' || state.selected.size === 0;
    document.body.classList.toggle('has-bulk', view === 'nodes' && state.selected.size > 0 && !el.app.hidden);
    if (view === 'preview' && (!state.preview || state.previewDirty)) loadPreview();
    if (view === 'nodes') renderNodeList();
    if (view === 'overview') renderOverview();
    if (view === 'users') loadUsers();
    if (view === 'settings') {
      if (isOwner()) renderSettings();
      else renderAccount();
    }
    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------------ */
  /* settings (parameter presets)                                        */
  /* ------------------------------------------------------------------ */

  function currentDefaults() {
    return (state.config && state.config.defaults) || {};
  }

  function renderAuthTokenNote() {
    if (!el.authTokenNote) return;
    var meta = state.meta || {};
    var hint = meta.authTokenHint || '';
    if (meta.authSource === 'settings') {
      el.authTokenNote.textContent = '当前令牌 ' + hint + '（由设置页保存）；保存新值会立即使旧令牌失效，点「清除」可删除并回退到环境变量。为避免明文外泄，控制台不再回显完整令牌，需要新令牌请点「生成」。该令牌仅用于订阅访问，不能登录控制台。';
    } else if (meta.authSource === 'environment') {
      el.authTokenNote.textContent = '当前使用环境变量 AUTH_TOKEN' + (hint ? '（' + hint + '）' : '') + '；填写新令牌并保存后，改由设置页管理。该令牌仅用于订阅访问，不能登录控制台。';
    } else {
      el.authTokenNote.textContent = '当前尚未配置订阅令牌，填写并保存后订阅链接立即可用；该令牌不能用于登录控制台。';
    }
  }

  function renderSettings() {
    if (!state.config) return;
    var defaults = currentDefaults();
    var info = state.config.subscription || {};
    state.clearAuthToken = false;
    // 令牌不回显明文：输入框始终留空，占位符给出掩码与下一步操作提示
    setField(el.setAuthToken, '');
    if (el.setAuthToken) {
      el.setAuthToken.placeholder = (state.meta && state.meta.authTokenHint)
        ? '当前 ' + state.meta.authTokenHint + '；留空保持不变'
        : '至少 16 个字符';
    }
    setField(el.setProviderBase, state.config.providerBase || '');
    renderAuthTokenNote();
    setField(el.setUuid, defaults.vlessUuid || '');
    setField(el.setPbk, defaults.vlessPublicKey || '');
    setField(el.setSid, defaults.vlessShortId || '');
    setField(el.setSni, defaults.vlessServername || '');
    setField(el.setPort, defaults.vlessPort > 0 ? defaults.vlessPort : '');
    setField(el.setTotal, info.totalGB > 0 ? info.totalGB : '');
    setField(el.setExpire, info.expire || '');
    el.settingsUpdated.textContent = state.config.updatedAt
      ? '保存于 ' + formatShort(state.config.updatedAt)
      : '尚未保存';
    applyThemeUi();
    clearSettingsErrors();
  }

  function setSettingsBusy(busy) {
    el.settingsSave.disabled = busy;
    el.settingsSave.classList.toggle('is-loading', busy);
    el.settingsSaveSpinner.hidden = !busy;
    el.settingsSaveLabel.textContent = busy ? '保存中…' : '保存设置';
  }

  function clearSettingsErrors() {
    $$('.field.has-error', el.settingsForm).forEach(function (field) { field.classList.remove('has-error'); });
    $$('.field-error', el.settingsForm).forEach(function (error) { error.textContent = ''; });
    $$('[aria-invalid="true"]', el.settingsForm).forEach(function (input) { input.removeAttribute('aria-invalid'); });
    el.settingsGlobalError.hidden = true;
    el.settingsGlobalError.textContent = '';
  }

  function clearSettingsFieldError(event) {
    var field = event.target.closest ? event.target.closest('.field') : null;
    if (field) {
      field.classList.remove('has-error');
      $$('.field-error', field).forEach(function (error) { error.textContent = ''; });
      $$('[aria-invalid="true"]', field).forEach(function (input) { input.removeAttribute('aria-invalid'); });
    }
    if (!el.settingsGlobalError.hidden) {
      el.settingsGlobalError.hidden = true;
      el.settingsGlobalError.textContent = '';
    }
  }

  function showSettingsErrors(errors) {
    clearSettingsErrors();
    var globalMessage = '';
    var firstInput = null;
    (errors || []).forEach(function (error) {
      var target = $('[data-error="' + error.key + '"]', el.settingsForm);
      if (!target) {
        if (!globalMessage) globalMessage = error.message;
        return;
      }
      var field = target.closest('.field');
      field.classList.add('has-error');
      target.textContent = error.message;
      var fieldInput = $('input, select', field);
      if (fieldInput) fieldInput.setAttribute('aria-invalid', 'true');
      if (!firstInput) firstInput = fieldInput;
    });
    if (globalMessage) {
      el.settingsGlobalError.textContent = globalMessage;
      el.settingsGlobalError.hidden = false;
    }
    if (firstInput) {
      firstInput.focus({ preventScroll: true });
      firstInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (globalMessage) {
      el.settingsGlobalError.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function collectSettings() {
    var errors = [];
    var defaults = {};

    var authToken = '';
    var authTokenRaw = String(el.setAuthToken.value || '').trim();
    if (authTokenRaw) {
      // 掩码优先于长度：粘贴回来的掩码无论多长都是同一个误操作，提示只给一条
      if (authTokenRaw.indexOf('\\u2022') !== -1) {
        errors.push({ key: 'setAuthToken', message: '订阅令牌不能包含掩码字符，请填写完整令牌' });
      } else if (authTokenRaw.length < 16) {
        errors.push({ key: 'setAuthToken', message: '订阅令牌至少需要 16 个字符' });
      } else if (authTokenRaw.length > 256) {
        errors.push({ key: 'setAuthToken', message: '订阅令牌不能超过 256 个字符' });
      } else if (/[\\s\\u0000-\\u001f\\u007f]/.test(authTokenRaw)) {
        errors.push({ key: 'setAuthToken', message: '订阅令牌不能包含空格或控制字符' });
      } else {
        authToken = authTokenRaw;
      }
    }

    // 点击过「清除」且输入框为空：保存时下发 null 删除设置页令牌；一旦又输入了新值则取消清除
    var clearToken = state.clearAuthToken && !authTokenRaw;

    var providerBase = String(el.setProviderBase.value || '').trim();
    if (providerBase) {
      if (providerBase.length > 256) {
        errors.push({ key: 'setProviderBase', message: '镜像前缀不能超过 256 个字符' });
      } else if (!/^https:\\/\\/[A-Za-z0-9._~:\\/?#@!$&*+,;=%-]+$/.test(providerBase)) {
        errors.push({ key: 'setProviderBase', message: '镜像前缀需以 https:// 开头，且不含空格或引号' });
      }
    }

    var uuid = String(el.setUuid.value || '').trim();
    if (uuid) {
      if (!UUID_RE.test(uuid)) {
        errors.push({ key: 'setUuid', message: 'UUID 格式不正确' });
      } else {
        defaults.vlessUuid = uuid.toLowerCase();
      }
    }

    var pbk = String(el.setPbk.value || '').trim();
    if (pbk) {
      if (pbk.length > 128) {
        errors.push({ key: 'setPbk', message: 'Reality 公钥不能超过 128 个字符' });
      } else {
        defaults.vlessPublicKey = pbk;
      }
    }

    var sid = String(el.setSid.value || '').trim();
    if (sid) {
      if (sid.length > 32) {
        errors.push({ key: 'setSid', message: 'Reality Short ID 不能超过 32 个字符' });
      } else {
        defaults.vlessShortId = sid;
      }
    }

    var sni = hostError(el.setSni.value, 'setSni', 'SNI / 回落域名', false, errors);
    if (sni) defaults.vlessServername = sni;

    var portRaw = String(el.setPort.value || '').trim();
    if (portRaw) {
      var port = Number(portRaw);
      if (!/^\\d+$/.test(portRaw) || !Number.isInteger(port) || port < 1 || port > 65535) {
        errors.push({ key: 'setPort', message: '需为 1–65535 的整数' });
      } else {
        defaults.vlessPort = port;
      }
    }

    var subscription = {};
    var totalRaw = String(el.setTotal.value || '').trim();
    if (totalRaw) {
      var total = Number(totalRaw);
      if (!Number.isFinite(total) || total <= 0) {
        errors.push({ key: 'setTotal', message: '流量上限必须是大于 0 的数字' });
      } else if (total > MAX_TOTAL_GB) {
        errors.push({ key: 'setTotal', message: '流量上限不能超过 ' + MAX_TOTAL_GB + ' GB' });
      } else {
        subscription.totalGB = Math.round(total * 100) / 100;
      }
    }

    var expire = String(el.setExpire.value || '').trim();
    if (expire) {
      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(expire) || Number.isNaN(Date.parse(expire + 'T00:00:00Z'))) {
        errors.push({ key: 'setExpire', message: '到期日期格式不正确' });
      } else {
        subscription.expire = expire;
      }
    }

    return {
      defaults: defaults,
      subscription: subscription,
      authToken: authToken,
      providerBase: providerBase,
      clearToken: clearToken,
      errors: errors
    };
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (state.mutating) return;
    if (!ensureWritable()) return;
    clearSettingsErrors();
    var result = collectSettings();
    if (result.errors.length) {
      showSettingsErrors(result.errors);
      return;
    }

    state.mutating = true;
    setSettingsBusy(true);
    try {
      var body = {
        rev: state.rev,
        nodes: nodes(),
        defaults: result.defaults,
        subscription: result.subscription,
        providerBase: result.providerBase
      };
      if (result.clearToken) body.authToken = null;
      else if (result.authToken) body.authToken = result.authToken;
      var data = await request('/api/config', { method: 'PUT', body: body });
      applyConfig(data);
      renderAll();
      renderSettings();
      state.clearAuthToken = false;
      toast(result.clearToken
        ? '设置已保存，已清除订阅令牌并回退到环境变量'
        : (result.authToken
          ? '设置已保存，新订阅令牌即时生效'
          : '设置已保存，订阅信息即时生效，新建 VLESS 节点将使用新预设'), 'success');
    } catch (err) {
      if (err.status === 401) {
        handleUnauthorized();
      } else if (err.status === 409) {
        toast(err.message, 'error');
        await reloadConfig();
        renderSettings();
      } else if (err.status === 503) {
        toast(err.message, 'error');
        openModal('kv');
        await reloadConfig();
      } else {
        toast(err.message || '保存失败，请稍后重试', 'error');
      }
    } finally {
      state.mutating = false;
      setSettingsBusy(false);
    }
  }

  /* ------------------------------------------------------------------ */
  /* users                                                               */
  /* ------------------------------------------------------------------ */

  function findUser(id) {
    return (state.users || []).filter(function (user) { return user.id === id; })[0] || null;
  }

  function userInitial(name) {
    var text = String(name || '?').trim();
    return text ? text.charAt(0).toUpperCase() : '?';
  }

  function syncUserAddState() {
    if (!el.userAdd) return;
    var maxed = Array.isArray(state.users) && state.users.length >= MAX_USERS;
    el.userAdd.disabled = maxed || (el.userForm && !el.userForm.hidden);
    el.userAdd.title = maxed ? '最多只能创建 ' + MAX_USERS + ' 个用户' : '';
  }

  function applyUsersResponse(data) {
    if (!data) return;
    if (Array.isArray(data.users)) state.users = data.users;
    state.usersRev = Number(data.rev) || 0;
    if (data.currentUserId) state.currentUserId = data.currentUserId;
    if (data.token) {
      state.token = data.token;
      storageSet('session', STORAGE_KEY, data.token);
    }
    renderUsers();
  }

  function syncRoleUi() {
    var owner = isOwner();
    document.body.classList.toggle('is-member', !owner);
    $$('[data-owner-only]').forEach(function (panel) { panel.hidden = !owner; });
    $$('[data-member-only]').forEach(function (panel) { panel.hidden = owner; });
  }

  function renderAccount() {
    var meta = state.meta || {};
    var scope = meta.scope || {};
    var personalCount = personalNodes().length;
    var sharedCount = Math.max(nodes().length - personalCount, 0);
    if (el.accountUsername) el.accountUsername.value = meta.username || '';
    if (el.accountRole) el.accountRole.textContent = isOwner() ? '所有者' : '成员';
    if (el.accountScope) {
      el.accountScope.value = (scope.allNodes ? '全部共享节点' : '已分配共享节点') +
        '（' + sharedCount + ' 个） · 个人节点（' + personalCount + ' 个）';
    }
    if (el.accountSubUrl) {
      el.accountSubUrl.value = meta.subUrl ? maskToken(meta.subUrl) : '';
      el.accountSubUrl.placeholder = meta.subUrl ? '' : '订阅链接尚未生成，请稍后刷新';
    }
    if (el.accountSubCopy) el.accountSubCopy.disabled = !meta.subUrl;
    if (el.accountPanel) el.accountPanel.hidden = isOwner();
  }

  function setPasswordBusy(busy) {
    if (el.pwSave) {
      el.pwSave.disabled = busy;
      el.pwSave.classList.toggle('is-loading', busy);
    }
    if (el.pwSpinner) el.pwSpinner.hidden = !busy;
    if (el.pwSaveLabel) el.pwSaveLabel.textContent = busy ? '更新中…' : '更新密码';
  }

  function clearPasswordErrors() {
    if (!el.passwordForm) return;
    $$('.field.has-error', el.passwordForm).forEach(function (field) { field.classList.remove('has-error'); });
    $$('[data-error]', el.passwordForm).forEach(function (error) { error.textContent = ''; });
    $$('[aria-invalid="true"]', el.passwordForm).forEach(function (input) { input.removeAttribute('aria-invalid'); });
  }

  function showPasswordErrors(errors) {
    clearPasswordErrors();
    var global = $('[data-error="global"]', el.passwordForm);
    (errors || []).forEach(function (error) {
      var key = error.key || 'global';
      var target = $('[data-error="' + key + '"]', el.passwordForm) || global;
      if (!target) return;
      target.textContent = error.message;
      if (target === global) return;
      var field = target.closest('.field');
      if (field) field.classList.add('has-error');
      var input = field ? $('input', field) : null;
      if (input) input.setAttribute('aria-invalid', 'true');
    });
  }

  async function submitPasswordChange(event) {
    if (event) event.preventDefault();
    if (state.passwordBusy) return;
    clearPasswordErrors();
    var current = el.pwCurrent.value || '';
    var next = el.pwNew.value || '';
    var confirm = el.pwConfirm.value || '';
    var errors = [];
    if (!current) errors.push({ key: 'currentPassword', message: '请输入当前密码' });
    if (!next) {
      errors.push({ key: 'newPassword', message: '请输入新密码' });
    } else if (next.length < PASSWORD_MIN) {
      errors.push({ key: 'newPassword', message: '密码至少需要 ' + PASSWORD_MIN + ' 个字符' });
    } else if (next.length > 128) {
      errors.push({ key: 'newPassword', message: '密码不能超过 128 个字符' });
    } else if (next !== confirm) {
      errors.push({ key: 'newPassword', message: '两次输入的新密码不一致' });
    }
    if (errors.length) {
      showPasswordErrors(errors);
      return;
    }

    state.passwordBusy = true;
    setPasswordBusy(true);
    try {
      var data = await request('/api/password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next }
      });
      if (data && data.token) {
        state.token = data.token;
        storageSet('session', STORAGE_KEY, data.token);
      }
      el.pwCurrent.value = '';
      el.pwNew.value = '';
      el.pwConfirm.value = '';
      toast('密码已更新，其他设备的登录与旧订阅链接已失效', 'success');
      await reloadConfig();
      renderAccount();
    } catch (err) {
      if (err.status === 401) {
        handleUnauthorized();
        return;
      }
      showPasswordErrors([{ key: err.field || 'global', message: err.message || '修改失败，请稍后重试' }]);
    } finally {
      state.passwordBusy = false;
      setPasswordBusy(false);
    }
  }

  async function loadUsers(force) {
    if (!state.config) return;
    if (!isOwner()) {
      renderAccount();
      return;
    }
    if (!force && Array.isArray(state.users)) {
      renderUsers();
      return;
    }
    if (state.usersLoading) return;
    state.usersLoading = true;
    if (!Array.isArray(state.users) || force) {
      el.userList.innerHTML = '<div class="user-empty">正在载入账号…</div>';
    }
    try {
      applyUsersResponse(await request('/api/users'));
    } catch (err) {
      if (err.status === 401) {
        handleUnauthorized();
        return;
      }
      el.userList.innerHTML = '<div class="user-empty is-error">' + esc(err.message || '账号加载失败，请稍后重试') + '</div>';
    } finally {
      state.usersLoading = false;
    }
  }

  function scopeSummary(user) {
    if (user.role === 'owner') return '全部节点';
    var scope = user.scope || {};
    if (scope.allNodes) return '全部节点';
    var count = Array.isArray(scope.nodeIds) ? scope.nodeIds.length : 0;
    return count ? count + ' 个节点' : '未分配节点';
  }

  function renderUsers() {
    if (!el.userList) return;
    var users = Array.isArray(state.users) ? state.users : [];
    if (!users.length) {
      el.userList.innerHTML = '<div class="user-empty">还没有可用账号，请添加一个。</div>';
      syncUserAddState();
      return;
    }
    var ownerCount = users.filter(function (user) { return user.role === 'owner'; }).length;
    el.userList.innerHTML = users.map(function (user) {
      var current = user.id === state.currentUserId;
      var isOwnerUser = user.role === 'owner';
      var lastOwner = isOwnerUser && ownerCount <= 1;
      var canDelete = !current && users.length > 1 && !lastOwner;
      var created = user.createdAt ? formatShort(user.createdAt) : '';
      var deleteTitle = current
        ? '不能删除当前登录账号'
        : (lastOwner ? '至少需要保留一个所有者账号' : (users.length <= 1 ? '至少需要保留一个账号' : '删除账号'));
      return '<div class="user-row' + (current ? ' is-current' : '') + '">' +
        '<span class="user-avatar">' + esc(userInitial(user.username)) + '</span>' +
        '<span class="user-main">' +
          '<span class="user-name" title="' + esc(user.username) + '">' + esc(user.username) + (current ? '<span class="user-badge">当前账号</span>' : '') + '</span>' +
          '<span class="user-sub">' +
            '<span class="role-badge' + (isOwnerUser ? ' is-owner' : '') + '">' + (isOwnerUser ? '所有者' : '成员') + '</span>' +
            '<span>可用 ' + esc(scopeSummary(user)) + '</span>' +
            (created ? '<span>创建于 ' + esc(created) + '</span>' : '') +
          '</span>' +
        '</span>' +
        '<span class="user-actions">' +
          '<button class="btn btn-quiet btn-sm" type="button" data-user-manage="' + esc(user.id) + '">管理</button>' +
          '<button class="btn btn-quiet btn-sm user-delete" type="button" data-user-delete="' + esc(user.id) + '"' +
            (canDelete ? ' title="删除账号" aria-label="删除账号 ' + esc(user.username) + '"' : ' disabled title="' + deleteTitle + '"') +
            '>' + icon('trash') + '</button>' +
        '</span>' +
      '</div>';
    }).join('');
    syncUserAddState();
  }

  function clearUserErrors() {
    if (!el.userForm) return;
    $$('.field', el.userForm).forEach(function (field) { field.classList.remove('has-error'); });
    $$('[data-user-error]', el.userForm).forEach(function (error) { error.textContent = ''; });
    $$('[aria-invalid="true"]', el.userForm).forEach(function (input) { input.removeAttribute('aria-invalid'); });
  }

  function clearUserFieldError(event) {
    var field = event.target.closest ? event.target.closest('.field') : null;
    if (!field) return;
    field.classList.remove('has-error');
    $$('[data-user-error]', field).forEach(function (error) { error.textContent = ''; });
    $$('[aria-invalid="true"]', field).forEach(function (input) { input.removeAttribute('aria-invalid'); });
    var global = $('[data-user-error="global"]', el.userForm);
    if (global) global.textContent = '';
  }

  function showUserErrors(errors) {
    clearUserErrors();
    var firstInput = null;
    (errors || []).forEach(function (error) {
      var key = error.key || 'global';
      var target = $('[data-user-error="' + key + '"]', el.userForm);
      if (!target) target = $('[data-user-error="global"]', el.userForm);
      if (!target) return;
      target.textContent = error.message;
      if (key === 'global' || target.getAttribute('data-user-error') === 'global') return;
      var field = target.closest('.field');
      if (!field) return;
      field.classList.add('has-error');
      var input = $('input', field);
      if (input) {
        input.setAttribute('aria-invalid', 'true');
        if (!firstInput) firstInput = input;
      }
    });
    if (firstInput) firstInput.focus({ preventScroll: true });
  }

  function setUserBusy(busy) {
    el.userSave.disabled = busy;
    el.userSave.classList.toggle('is-loading', busy);
    el.userSaveSpinner.hidden = !busy;
    el.userCancel.disabled = busy;
    if (!busy) {
      el.userSaveLabel.textContent = state.userFormMode === 'manage' ? '保存修改' : '添加用户';
    }
  }

  function scopeFromForm() {
    var allNodes = !!(el.userScopeAll && el.userScopeAll.checked);
    var nodeIds = [];
    if (!allNodes && el.userScopeList) {
      $$('input[type="checkbox"]', el.userScopeList).forEach(function (input) {
        if (input.checked) nodeIds.push(input.value);
      });
    }
    return { allNodes: allNodes, nodeIds: nodeIds };
  }

  function renderUserScope(scope, role) {
    if (!el.userScopeField) return;
    var owner = role === 'owner';
    var allNodes = owner || !scope || scope.allNodes === true;
    var selected = {};
    ((scope && scope.nodeIds) || []).forEach(function (id) { selected[id] = true; });
    el.userScopeField.hidden = owner;
    if (el.userScopeAll) {
      el.userScopeAll.checked = allNodes;
      el.userScopeAll.disabled = owner;
    }
    if (!el.userScopeList) return;
    el.userScopeList.classList.toggle('is-all', allNodes);
    var list = nodes();
    if (!list.length) {
      el.userScopeList.innerHTML = '<div class="scope-empty">还没有节点；保存后该成员不会获得任何节点。</div>';
      return;
    }
    el.userScopeList.innerHTML = list.map(function (node) {
      var type = TYPE_META[node.type] || { label: node.type };
      var region = REGION_META[node.region] || REGION_META.other;
      var on = allNodes || !!selected[node.id];
      return '<label class="scope-item">' +
        '<input class="check-input" type="checkbox" value="' + esc(node.id) + '"' + (on ? ' checked' : '') + (allNodes ? ' disabled' : '') + '>' +
        '<span class="scope-name">' + esc(node.name) + '</span>' +
        '<span class="scope-meta">' + esc(region.short) + ' · ' + esc(type.label) + '</span>' +
        '</label>';
    }).join('');
  }

  function syncScopeControls() {
    var allNodes = !!(el.userScopeAll && el.userScopeAll.checked);
    if (!el.userScopeList) return;
    el.userScopeList.classList.toggle('is-all', allNodes);
    $$('input[type="checkbox"]', el.userScopeList).forEach(function (input) {
      input.disabled = allNodes;
      if (allNodes) input.checked = true;
    });
  }

  function openUserEditor(mode, id) {
    if (!el.userForm || !isOwner()) return;
    if (mode === 'manage') {
      var user = findUser(id);
      if (!user) return;
      state.userFormMode = 'manage';
      state.userFormId = id;
      el.userFormTitle.textContent = '管理账号';
      el.userFormSub.textContent = user.id === state.currentUserId
        ? '调整当前账号的角色与节点范围；密码留空则保持不变。'
        : '调整 ' + user.username + ' 的角色与可用节点；密码留空则保持不变。';
      el.userUsername.value = user.username;
      el.userUsername.disabled = true;
      el.userRole.value = user.role === 'owner' ? 'owner' : 'member';
      renderUserScope(user.scope, user.role);
      el.userSaveLabel.textContent = '保存修改';
    } else {
      state.userFormMode = 'add';
      state.userFormId = null;
      el.userFormTitle.textContent = '添加账号';
      el.userFormSub.textContent = '新账号默认是成员，只能使用分配的共享节点并添加个人节点；需要全部权限时可设为所有者。';
      el.userUsername.value = '';
      el.userUsername.disabled = false;
      el.userRole.value = 'member';
      renderUserScope({ allNodes: false, nodeIds: [] }, 'member');
      el.userSaveLabel.textContent = '添加用户';
    }
    if (el.userPasswordHint) el.userPasswordHint.hidden = state.userFormMode === 'add';
    el.userPassword.value = '';
    el.userPassword2.value = '';
    clearUserErrors();
    setUserBusy(false);
    el.userForm.hidden = false;
    syncUserAddState();
    window.setTimeout(function () {
      var target = state.userFormMode === 'add' ? el.userUsername : el.userPassword;
      el.userForm.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      target.focus({ preventScroll: true });
    }, 40);
  }

  function closeUserEditor() {
    if (!el.userForm) return;
    el.userForm.hidden = true;
    state.userFormMode = 'add';
    state.userFormId = null;
    el.userUsername.value = '';
    el.userUsername.disabled = false;
    if (el.userRole) el.userRole.value = 'member';
    if (el.userPasswordHint) el.userPasswordHint.hidden = true;
    el.userPassword.value = '';
    el.userPassword2.value = '';
    clearUserErrors();
    setUserBusy(false);
    syncUserAddState();
  }

  function collectUserForm() {
    var errors = [];
    var mode = state.userFormMode;
    var username = String(el.userUsername.value || '').trim();
    var password = el.userPassword.value || '';
    var confirm = el.userPassword2.value || '';
    var role = el.userRole && el.userRole.value === 'owner' ? 'owner' : 'member';
    var scope = role === 'owner' ? { allNodes: true, nodeIds: [] } : scopeFromForm();
    if (mode === 'add') {
      if (!username) {
        errors.push({ key: 'username', message: '请输入用户名' });
      } else if (!USERNAME_RE.test(username)) {
        errors.push({ key: 'username', message: '需 3–254 位，以字母或数字开头，可含 . _ + @ -，也可直接填写邮箱' });
      }
    }
    if (mode === 'add' || password) {
      if (!password) {
        errors.push({ key: 'password', message: '请输入密码' });
      } else if (password.length < PASSWORD_MIN) {
        errors.push({ key: 'password', message: '密码至少需要 ' + PASSWORD_MIN + ' 个字符' });
      } else if (password.length > 128) {
        errors.push({ key: 'password', message: '密码不能超过 128 个字符' });
      } else if (password !== confirm) {
        errors.push({ key: 'password', message: '两次输入的密码不一致' });
      }
    }
    return { username: username, password: password, role: role, scope: scope, errors: errors };
  }

  async function submitUserForm(event) {
    if (event) event.preventDefault();
    if (state.userBusy) return;
    clearUserErrors();
    var result = collectUserForm();
    if (result.errors.length) {
      showUserErrors(result.errors);
      return;
    }
    var mode = state.userFormMode;
    var id = state.userFormId;
    state.userBusy = true;
    setUserBusy(true);
    try {
      var data;
      if (mode === 'add') {
        data = await request('/api/users', {
          method: 'POST',
          body: {
            rev: state.usersRev,
            username: result.username,
            password: result.password,
            role: result.role,
            scope: result.scope
          }
        });
      } else {
        var body = { rev: state.usersRev, id: id, role: result.role, scope: result.scope };
        if (result.password) body.password = result.password;
        data = await request('/api/users/update', { method: 'POST', body: body });
      }
      applyUsersResponse(data);
      closeUserEditor();
      if (mode === 'add') {
        toast('已添加' + (result.role === 'owner' ? '所有者' : '成员') + '「' + result.username + '」', 'success');
      } else {
        toast(result.password ? '账号权限与密码已更新' : '账号权限已更新', 'success');
      }
    } catch (err) {
      if (err.status === 401) {
        handleUnauthorized();
        return;
      }
      if (err.status === 409) await loadUsers(true);
      showUserErrors([{ key: err.field || 'global', message: err.message || '保存失败，请稍后重试' }]);
    } finally {
      state.userBusy = false;
      setUserBusy(false);
    }
  }

  function askDeleteUser(id) {
    var user = findUser(id);
    if (!user) return;
    if (id === state.currentUserId) {
      toast('不能删除当前登录账号', 'info');
      return;
    }
    var users = state.users || [];
    if (users.length <= 1) {
      toast('至少需要保留一个管理员账号', 'info');
      return;
    }
    if (user.role === 'owner' && users.filter(function (item) { return item.role === 'owner'; }).length <= 1) {
      toast('至少需要保留一个所有者账号', 'info');
      return;
    }
    state.userDeletingId = id;
    openConfirm({
      title: '删除这个账号？',
      segments: [
        { text: '即将删除 ' },
        { strong: true, text: user.username },
        { text: '，该账号会立即退出登录，其独立订阅链接同时失效且无法恢复。' }
      ],
      okLabel: '删除账号',
      danger: true,
      onOk: confirmDeleteUser
    });
  }

  async function confirmDeleteUser() {
    var id = state.userDeletingId;
    if (!id || state.userBusy) return;
    var user = findUser(id);
    if (!user) {
      closeModal('generic');
      return;
    }
    state.userBusy = true;
    el.genericOk.disabled = true;
    el.genericOk.textContent = '删除中…';
    try {
      var data = await request('/api/users/delete', {
        method: 'POST',
        body: { rev: state.usersRev, id: id }
      });
      state.userDeletingId = null;
      applyUsersResponse(data);
      closeModal('generic');
      toast('已删除账号「' + user.username + '」', 'success');
    } catch (err) {
      if (err.status === 401) {
        closeModal('generic');
        handleUnauthorized();
        return;
      }
      if (err.status === 409) await loadUsers(true);
      el.genericOk.disabled = false;
      el.genericOk.textContent = '删除账号';
      toast(err.message || '删除失败，请稍后重试', 'error');
    } finally {
      state.userBusy = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* node actions                                                        */
  /* ------------------------------------------------------------------ */

  function findNode(id) {
    return nodes().filter(function (node) { return node.id === id; })[0] || null;
  }

  function ensureWritable() {
    var meta = state.meta;
    if (!meta) return false;
    if (!meta.kv || meta.readonly) {
      openModal('kv');
      toast('当前为只读模式，绑定 KV 存储后才能保存修改', 'info');
      return false;
    }
    return true;
  }

  function setRowBusy(button, busy) {
    if (button) button.disabled = busy;
  }

  async function saveNodes(nextNodes, options) {
    var opts = options || {};
    if (state.mutating) return false;
    state.mutating = true;
    if (opts.form) setSaveBusy(true);

    try {
      var owner = isOwner();
      // 成员只把个人节点发到 /api/nodes；新建节点尚未进入 meta.personalNodeIds，
      // 但 id 已按 p_ 命名空间生成，同样需要带上
      var payloadNodes = owner ? nextNodes : nextNodes.filter(function (node) {
        return isPersonalNode(node) || /^p_/.test(node.id);
      });
      var body = owner
        ? { rev: state.rev, nodes: payloadNodes }
        : { rev: Number((state.meta && state.meta.personalRev) || 0), nodes: payloadNodes };
      if (owner) {
        if (opts.defaults) body.defaults = opts.defaults;
        if (opts.subscription) body.subscription = opts.subscription;
        if (opts.regionOrder) body.regionOrder = opts.regionOrder;
        if (opts.providerBase !== undefined) body.providerBase = opts.providerBase;
      }
      var data = await request(owner ? '/api/config' : '/api/nodes', {
        method: 'PUT',
        body: body
      });
      applyConfig(data);
      renderAll();
      if (opts.form) closeDrawer();
      if (opts.successMessage) toast(opts.successMessage, 'success', opts.successAction);
      if (state.view === 'preview') loadPreview(true);
      return true;
    } catch (err) {
      if (err.status === 401) {
        handleUnauthorized();
        return false;
      }
      if (err.status === 409) {
        toast(err.message, 'error');
        // 保留抽屉与已填内容，只同步最新 rev：用户再点一次保存即可覆盖，不必重填
        if (opts.form) {
          el.formGlobalError.textContent = err.message + '。当前填写的内容已保留，确认后再次保存即可覆盖。';
          el.formGlobalError.hidden = false;
          el.formGlobalError.scrollIntoView({ block: 'nearest' });
          await reloadConfig();
          return false;
        }
        await reloadConfig();
        return false;
      }
      if (err.status === 503) {
        toast(err.message, 'error');
        openModal('kv');
        await reloadConfig();
        return false;
      }
      if (opts.form && err.field) {
        showFormErrors([{ key: apiFieldKey(err.field), message: err.message }]);
        toast(err.message, 'error');
        return false;
      }
      if (opts.form && err.status !== 0) {
        el.formGlobalError.textContent = err.message;
        el.formGlobalError.hidden = false;
        el.formGlobalError.scrollIntoView({ block: 'nearest' });
      }
      toast(err.message || '保存失败，请稍后重试', 'error');
      if (opts.rerenderOnError) renderAll();
      return false;
    } finally {
      state.mutating = false;
      if (opts.form) setSaveBusy(false);
    }
  }

  async function reloadConfig() {
    try {
      var data = await request('/api/config');
      applyConfig(data);
      renderAll();
      if (state.view === 'preview') loadPreview(true);
      return true;
    } catch (err) {
      if (err.status === 401) handleUnauthorized();
      else toast(err.message || '刷新配置失败', 'error');
      return false;
    }
  }

  async function toggleNode(id, button) {
    if (!ensureWritable() || state.mutating) return;
    var target = findNode(id);
    if (!editableNode(target)) return;
    var nextEnabled = !target.enabled;
    setRowBusy(button, true);
    var nextNodes = nodes().map(function (node) {
      return node.id === id ? Object.assign({}, node, { enabled: nextEnabled }) : node;
    });
    var ok = await saveNodes(nextNodes, {
      successMessage: nextEnabled ? '节点已启用' : '节点已停用',
      rerenderOnError: true
    });
    if (!ok && button) button.disabled = false;
  }

  function uniqueCopyName(base) {
    var used = new Set(nodes().map(function (node) { return node.name.toLowerCase(); }));
    var root = base.replace(/\\s*副本(?:\\s+\\d+)?$/, '').trim().slice(0, 76) || '未命名节点';
    var candidate = root + ' 副本';
    var index = 2;
    while (used.has(candidate.toLowerCase())) {
      var suffix = ' 副本 ' + index;
      candidate = root.slice(0, 80 - suffix.length) + suffix;
      index += 1;
    }
    return candidate;
  }

  async function duplicateNode(id) {
    if (!ensureWritable() || state.mutating) return;
    var source = findNode(id);
    if (!editableNode(source)) return;
    var limit = nodeLimit();
    if (personalNodes().length >= limit) {
      toast('节点数量已达到上限 ' + limit + ' 个', 'error');
      return;
    }
    var copy = Object.assign({}, source, { id: newNodeId(), name: uniqueCopyName(source.name) });
    var nextNodes = nodes().slice();
    var index = nextNodes.findIndex(function (node) { return node.id === id; });
    nextNodes.splice(index + 1, 0, copy);
    await saveNodes(nextNodes, {
      successMessage: '已创建节点副本「' + copy.name + '」',
      rerenderOnError: true
    });
  }

  /* 通用确认弹窗：删除节点、导入备份等不可撤销操作共用 */
  var confirmCallback = null;

  function setGenericVisual(danger) {
    el.genericIcon.className = 'modal-icon ' + (danger ? 'tone-rose' : 'tone-indigo');
    var use = $('use', el.genericIcon);
    if (use) use.setAttribute('href', danger ? '#i-trash' : '#i-info');
    el.genericOk.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
  }

  function openConfirm(options) {
    var opts = options || {};
    el.genericTitle.textContent = opts.title || '确认操作';
    el.genericBody.textContent = '';
    (opts.segments || [{ text: '确认执行此操作吗？' }]).forEach(function (seg) {
      if (seg.strong) {
        var strong = document.createElement('strong');
        strong.textContent = seg.text;
        el.genericBody.appendChild(strong);
      } else {
        el.genericBody.appendChild(document.createTextNode(seg.text));
      }
    });
    el.genericOk.disabled = false;
    el.genericOk.textContent = opts.okLabel || '确认';
    setGenericVisual(opts.danger !== false);
    confirmCallback = typeof opts.onOk === 'function' ? opts.onOk : null;
    openModal('generic');
  }

  function askDelete(id) {
    if (!ensureWritable()) return;
    var target = findNode(id);
    if (!editableNode(target)) return;
    state.deletingId = id;
    openConfirm({
      title: '删除这个节点？',
      segments: [
        { text: '即将删除 ' },
        { strong: true, text: target.name },
        { text: '，该操作会立即写入订阅且无法撤销。' }
      ],
      okLabel: '删除节点',
      danger: true,
      onOk: confirmDelete
    });
  }

  async function confirmDelete() {
    var id = state.deletingId;
    if (!id || state.mutating) return;
    var target = findNode(id);
    if (!target) {
      closeModal('generic');
      return;
    }
    el.genericOk.disabled = true;
    el.genericOk.textContent = '删除中…';
    var nextNodes = nodes().filter(function (node) { return node.id !== id; });
    var ok = await saveNodes(nextNodes, {
      successMessage: '节点「' + target.name + '」已删除',
      rerenderOnError: true
    });
    el.genericOk.disabled = false;
    el.genericOk.textContent = '删除节点';
    if (ok) {
      state.deletingId = null;
      closeModal('generic');
    }
  }

  /* ------------------------------------------------------------------ */
  /* backup export / import                                              */
  /* ------------------------------------------------------------------ */

  function backupStamp() {
    var now = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
      '-' + pad(now.getHours()) + pad(now.getMinutes());
  }

  function exportBackup() {
    if (!state.config) return;
    var payload = {
      app: 'transit-hub',
      v: 1,
      exportedAt: new Date().toISOString(),
      nodes: nodes(),
      defaults: currentDefaults(),
      regionOrder: (state.config && state.config.regionOrder) || {},
      subscription: (state.config && state.config.subscription) || {},
      providerBase: (state.config && state.config.providerBase) || ''
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'transit-hub-backup-' + backupStamp() + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('备份已导出（' + nodes().length + ' 个节点）', 'success');
  }

  function importBackupFile(file) {
    if (!file || !ensureWritable()) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (err) {
        toast('备份文件不是有效的 JSON', 'error');
        return;
      }
      if (!parsed || !Array.isArray(parsed.nodes)) {
        toast('备份文件格式不正确：缺少节点数据', 'error');
        return;
      }
      openConfirm({
        title: '导入备份？',
        segments: [
          { text: '将用备份文件覆盖当前全部配置（' },
          { strong: true, text: String(parsed.nodes.length) + ' 个节点' },
          { text: '），包括参数预设、订阅信息与分组排序，该操作无法撤销。' }
        ],
        okLabel: '确认导入',
        danger: false,
        onOk: function () { doImport(parsed); }
      });
    };
    reader.onerror = function () { toast('读取备份文件失败', 'error'); };
    reader.readAsText(file);
  }

  async function doImport(parsed) {
    if (state.mutating) return;
    el.genericOk.disabled = true;
    el.genericOk.textContent = '导入中…';
    var ok = await saveNodes(parsed.nodes, {
      defaults: parsed.defaults && typeof parsed.defaults === 'object' ? parsed.defaults : {},
      regionOrder: parsed.regionOrder && typeof parsed.regionOrder === 'object' ? parsed.regionOrder : {},
      subscription: parsed.subscription && typeof parsed.subscription === 'object' ? parsed.subscription : {},
      providerBase: typeof parsed.providerBase === 'string' ? parsed.providerBase : '',
      successMessage: '已导入备份（' + parsed.nodes.length + ' 个节点）',
      rerenderOnError: true
    });
    el.genericOk.disabled = false;
    el.genericOk.textContent = '确认导入';
    if (ok) closeModal('generic');
  }

  /* ------------------------------------------------------------------ */
  /* share links                                                         */
  /* ------------------------------------------------------------------ */

  var SHARE_PARSERS = {
    vless: parseVlessLink,
    vmess: parseVmessLink,
    trojan: parseTrojanLink,
    hysteria2: parseHysteria2Link,
    hy2: parseHysteria2Link,
    ss: parseSSLink
  };

  var REGION_HINTS = [
    { key: 'relay', re: /中转|专线|iplc|iepl|relay|transit|bgp|入口|落地|沪日|深港/i },
    { key: 'hk', re: /香港|港台|台湾|台北|新北|彰化|高雄|hkg|hong\\s?kong|\\bhk\\b|\\btw\\b|taiwan|taipei/i },
    { key: 'jp', re: /日本|东京|大阪|埼玉|名古屋|jpn|tokyo|osaka|\\bjp\\b/i },
    { key: 'us', re: /美国|洛杉矶|圣何塞|硅谷|西雅图|纽约|芝加哥|达拉斯|凤凰城|迈阿密|usa|united\\s?states|los\\s?angeles|san\\s?jose|seattle|new\\s?york|chicago|dallas|\\bus\\b/i }
  ];

  function safeDecodeURI(value) {
    try {
      return decodeURIComponent(value);
    } catch (err) {
      return value;
    }
  }

  function base64UrlToBase64(value) {
    var text = String(value || '').replace(/-/g, '+').replace(/_/g, '/').replace(/\\s+/g, '');
    while (text.length % 4) text += '=';
    return text;
  }

  function decodeBase64Text(value) {
    var binary = window.atob(base64UrlToBase64(value));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function encodeBase64Text(value) {
    var bytes = new TextEncoder().encode(value);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary);
  }

  function encodeBase64Url(value) {
    return encodeBase64Text(value).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  }

  function parseShareQuery(raw) {
    var out = {};
    String(raw || '').split('&').forEach(function (pair) {
      if (!pair) return;
      var split = pair.indexOf('=');
      var key = split === -1 ? pair : pair.slice(0, split);
      var value = split === -1 ? '' : pair.slice(split + 1);
      out[safeDecodeURI(key).toLowerCase()] = safeDecodeURI(value.replace(/\\+/g, '%2B'));
    });
    return out;
  }

  function splitShareUri(line) {
    var match = String(line || '').match(/^([A-Za-z0-9+.-]+):\\/\\/(.*)$/);
    if (!match) return null;
    var scheme = match[1].toLowerCase();
    var rest = match[2];
    var name = '';
    var hash = rest.indexOf('#');
    if (hash !== -1) {
      name = safeDecodeURI(rest.slice(hash + 1)).trim();
      rest = rest.slice(0, hash);
    }
    var query = '';
    var mark = rest.indexOf('?');
    if (mark !== -1) {
      query = rest.slice(mark + 1);
      rest = rest.slice(0, mark);
    }
    if (scheme === 'vless' || scheme === 'trojan' || scheme === 'hysteria2' || scheme === 'hy2') {
      rest = rest.replace(/\\/+$/, '');
    }
    return { scheme: scheme, body: rest, query: parseShareQuery(query), name: name };
  }

  function splitShareAuthority(body) {
    var at = String(body || '').lastIndexOf('@');
    if (at === -1) return { userinfo: '', hostport: body || '' };
    return { userinfo: body.slice(0, at), hostport: body.slice(at + 1) };
  }

  function splitHostPort(value) {
    var text = String(value || '').trim();
    if (!text) return { host: '', port: 0 };
    if (text.charAt(0) === '[') {
      var close = text.indexOf(']');
      if (close === -1) return { host: '', port: 0 };
      var inside = text.slice(1, close);
      var rest = text.slice(close + 1);
      var portMatch = rest.match(/^:(\\d+)$/);
      return { host: inside, port: portMatch ? Number(portMatch[1]) : 0 };
    }
    var slash = text.indexOf('/');
    if (slash !== -1) text = text.slice(0, slash);
    var colon = text.lastIndexOf(':');
    if (colon === -1) return { host: text, port: 0 };
    return { host: text.slice(0, colon), port: Number(text.slice(colon + 1)) || 0 };
  }

  function shareHost(value, label) {
    var text = String(value || '').trim();
    if (!text) return '';
    if (text.length > 253 || CONTROL_RE.test(text) || !HOST_RE.test(text)) {
      throw new Error(label + '格式不正确');
    }
    return text;
  }

  function shareEndpoint(hostport) {
    var parts = splitHostPort(hostport);
    var host = String(parts.host || '').trim();
    if (!host || !HOST_RE.test(host) || CONTROL_RE.test(host)) throw new Error('服务器地址格式不正确');
    if (!parts.port || parts.port < 1 || parts.port > 65535) throw new Error('端口号无效');
    return { server: host, port: parts.port };
  }

  function shareBandwidth(value) {
    var text = String(value || '').trim();
    if (!text) return '';
    if (/^\\d{1,6}(?:\\.\\d{1,2})?$/.test(text)) return text + ' mbps';
    if (BANDWIDTH_RE.test(text)) return text;
    return '';
  }

  function shareBool(value) {
    return /^(1|true|yes|on)$/i.test(String(value || ''));
  }

  function parseVlessLink(parts) {
    if (!parts.body) throw new Error('缺少 UUID 与服务器地址');
    var auth = splitShareAuthority(parts.body);
    var uuid = safeDecodeURI(auth.userinfo);
    if (!uuid) throw new Error('缺少 UUID');
    if (!UUID_RE.test(uuid)) throw new Error('UUID 格式不正确');
    var endpoint = shareEndpoint(auth.hostport);
    var query = parts.query;
    var network = (query.type || 'tcp').toLowerCase();
    if (['tcp', 'ws', 'grpc'].indexOf(network) === -1) throw new Error('暂不支持 ' + network + ' 传输');
    var security = (query.security || '').toLowerCase();
    if (security === 'xtls') security = 'tls';
    if (security && ['tls', 'reality', 'none'].indexOf(security) === -1) throw new Error('暂不支持 ' + security + ' 加密方式');
    var reality = security === 'reality';
    var tls = security === 'tls' || reality;
    if (reality && !query.pbk) throw new Error('Reality 链接缺少 pbk 公钥');
    // 服务端只接受 TCP 上的 Reality；这里提前拦下，否则整批导入会被服务端一次拒绝
    if (reality && network !== 'tcp') throw new Error('Reality 仅支持 TCP 传输');

    var node = {
      type: 'vless',
      server: endpoint.server,
      port: endpoint.port,
      uuid: uuid.toLowerCase(),
      network: network,
      tls: tls,
      reality: reality,
      servername: shareHost(query.sni || query.host, 'SNI'),
      fingerprint: FINGERPRINTS.indexOf((query.fp || '').toLowerCase()) !== -1 ? query.fp.toLowerCase() : 'chrome',
      flow: (network === 'tcp' && tls) ? (query.flow || '') : '',
      udp: true
    };
    if (reality) {
      node.publicKey = String(query.pbk || '').slice(0, 128);
      node.shortId = String(query.sid || '').slice(0, 32);
    }
    if (network === 'ws') {
      node.wsPath = query.path || '/';
      node.wsHost = shareHost(query.host, 'WS Host');
    }
    if (network === 'grpc') {
      node.grpcService = String(query.servicename || query.path || '').slice(0, 64);
    }
    return { node: node, name: 'VLESS · ' + endpoint.server };
  }

  function parseVmessLink(parts) {
    var data;
    try {
      data = JSON.parse(decodeBase64Text(parts.body));
    } catch (err) {
      throw new Error('VMess 内容不是有效的 Base64 JSON');
    }
    if (!data || typeof data !== 'object') throw new Error('VMess 内容格式不正确');
    var uuid = String(data.id || '').trim();
    if (!UUID_RE.test(uuid)) throw new Error('UUID 格式不正确');
    var aid = data.aid === undefined || data.aid === null || data.aid === '' ? 0 : Number(data.aid);
    if (!Number.isInteger(aid) || aid < 0 || aid > 65535) throw new Error('VMess alterId 无效');
    if (aid) throw new Error('暂不支持 alterId ≠ 0 的旧版 VMess');
    if (data.scy && String(data.scy).toLowerCase() !== 'auto') {
      throw new Error('暂不支持 ' + data.scy + ' 加密方式');
    }
    var vmServer = String(data.add || '').trim();
    var vmPort = Number(data.port);
    if (!vmServer || !HOST_RE.test(vmServer) || CONTROL_RE.test(vmServer)) throw new Error('服务器地址格式不正确');
    if (!vmPort || vmPort < 1 || vmPort > 65535) throw new Error('端口号无效');
    var endpoint = { server: vmServer, port: vmPort };
    var network = String(data.net || 'tcp').toLowerCase();
    if (['tcp', 'ws', 'grpc'].indexOf(network) === -1) throw new Error('暂不支持 ' + network + ' 传输');
    var tls = String(data.tls || '').toLowerCase() === 'tls';
    var node = {
      type: 'vmess',
      server: endpoint.server,
      port: endpoint.port,
      uuid: uuid.toLowerCase(),
      network: network,
      tls: tls,
      servername: shareHost(data.sni || data.host, 'SNI'),
      udp: true
    };
    if (network === 'ws') {
      node.wsPath = data.path || '/';
      node.wsHost = shareHost(data.host, 'WS Host');
    }
    if (network === 'grpc') {
      node.grpcService = String(data.path || data.serviceName || '').slice(0, 64);
    }
    return { node: node, name: String(data.ps || '').trim() || ('VMess · ' + endpoint.server) };
  }

  function parseTrojanLink(parts) {
    if (!parts.body) throw new Error('缺少密码与服务器地址');
    var auth = splitShareAuthority(parts.body);
    var password = safeDecodeURI(auth.userinfo);
    if (!password) throw new Error('缺少密码');
    var endpoint = shareEndpoint(auth.hostport);
    var query = parts.query;
    var network = (query.type || 'tcp').toLowerCase();
    if (network !== 'tcp') throw new Error('Trojan 的 ' + network + ' 传输暂不支持');
    return {
      node: {
        type: 'trojan',
        server: endpoint.server,
        port: endpoint.port,
        password: password.slice(0, 128),
        sni: shareHost(query.sni || query.peer, 'SNI'),
        skipCertVerify: shareBool(query.allowinsecure || query.insecure),
        udp: true
      },
      name: 'Trojan · ' + endpoint.server
    };
  }

  function parseHysteria2Link(parts) {
    if (!parts.body) throw new Error('缺少密码与服务器地址');
    var auth = splitShareAuthority(parts.body);
    var password = safeDecodeURI(auth.userinfo);
    if (!password) throw new Error('缺少密码');
    var endpoint = shareEndpoint(auth.hostport);
    var query = parts.query;
    if (query.obfs) throw new Error('暂不支持 Hysteria2 的 obfs 混淆');
    return {
      node: {
        type: 'hysteria2',
        server: endpoint.server,
        port: endpoint.port,
        password: password.slice(0, 128),
        sni: shareHost(query.sni || query.peer, 'SNI'),
        skipCertVerify: shareBool(query.insecure || query.allowinsecure),
        up: shareBandwidth(query.up || query.upmbps),
        down: shareBandwidth(query.down || query.downmbps)
      },
      name: 'Hysteria2 · ' + endpoint.server
    };
  }

  function parseSSLink(parts) {
    var body = String(parts.body || '');
    if (!body) throw new Error('缺少加密方式与服务器地址');
    if (parts.query.plugin) throw new Error('暂不支持 Shadowsocks 插件');
    var userinfo = '';
    var hostport = '';
    var at = body.lastIndexOf('@');

    if (at !== -1) {
      var rawUser = body.slice(0, at);
      var decodedUser = safeDecodeURI(rawUser);
      if (decodedUser.indexOf(':') !== -1) {
        userinfo = decodedUser;
      } else {
        try {
          userinfo = decodeBase64Text(rawUser);
        } catch (err) {
          throw new Error('SS 用户信息不是有效的 Base64');
        }
      }
      hostport = body.slice(at + 1);
    } else {
      var decodedBody;
      try {
        decodedBody = decodeBase64Text(body);
      } catch (err) {
        throw new Error('SS 链接不是有效的 Base64');
      }
      var split = decodedBody.lastIndexOf('@');
      if (split === -1) throw new Error('SS 链接缺少服务器地址');
      userinfo = decodedBody.slice(0, split);
      hostport = decodedBody.slice(split + 1);
    }

    var colon = userinfo.indexOf(':');
    if (colon === -1) throw new Error('SS 链接缺少加密方式或密码');
    var cipher = userinfo.slice(0, colon).trim().toLowerCase();
    var password = userinfo.slice(colon + 1);
    if (SS_CIPHERS.indexOf(cipher) === -1) throw new Error('暂不支持 ' + cipher + ' 加密方式');
    if (!password) throw new Error('缺少密码');
    var endpoint = shareEndpoint(hostport);
    return {
      node: {
        type: 'ss',
        server: endpoint.server,
        port: endpoint.port,
        cipher: cipher,
        password: password.slice(0, 128),
        udp: true
      },
      name: 'SS · ' + endpoint.server
    };
  }

  function parseShareLink(line) {
    var parts = splitShareUri(line);
    if (!parts) throw new Error('不是有效的分享链接');
    var parser = SHARE_PARSERS[parts.scheme];
    if (!parser) throw new Error('暂不支持 ' + parts.scheme + ':// 协议');
    var parsed = parser(parts);
    if (!HOST_RE.test(parsed.node.server)) throw new Error('服务器地址格式不正确');
    return { node: parsed.node, title: parts.name || parsed.name };
  }

  function shareSignature(node) {
    var secret = node.uuid ? String(node.uuid).toLowerCase() : String(node.password || '');
    return [node.type, String(node.server || '').toLowerCase(), node.port, secret].join('|');
  }

  function guessShareRegion(text) {
    for (var i = 0; i < REGION_HINTS.length; i++) {
      if (REGION_HINTS[i].re.test(text)) return REGION_HINTS[i].key;
    }
    return 'other';
  }

  function shareNameBase(raw, node) {
    var text = String(raw || '').replace(CONTROL_RE, '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    if (!text) text = (TYPE_META[node.type] ? TYPE_META[node.type].label : node.type) + ' · ' + node.server;
    return text;
  }

  function uniqueShareName(base, used) {
    var root = String(base || '').slice(0, 80);
    if (RESERVED_NAMES.has(root)) root = root.slice(0, 74) + ' 节点';
    var candidate = root;
    var index = 2;
    while (used.has(candidate.toLowerCase())) {
      var suffix = ' ' + index;
      candidate = root.slice(0, 80 - suffix.length) + suffix;
      index += 1;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  }

  function parseShareLinks(text) {
    var usedNames = new Set(nodes().map(function (node) { return node.name.toLowerCase(); }));
    var known = new Set(nodes().map(shareSignature));
    var seenLines = {};
    var items = [];
    var errors = [];
    var lines = String(text || '').split(/\\r?\\n/);

    lines.forEach(function (raw, index) {
      var line = raw.trim();
      if (!line || line.charAt(0) === '#') return;
      if (seenLines[line]) return;
      seenLines[line] = true;
      try {
        var parsed = parseShareLink(line);
        var signature = shareSignature(parsed.node);
        if (known.has(signature)) {
          errors.push({ line: index + 1, message: '与已有节点重复，已跳过' });
          return;
        }
        known.add(signature);
        parsed.node.name = uniqueShareName(shareNameBase(parsed.title, parsed.node), usedNames);
        parsed.node.region = guessShareRegion([
          parsed.title, parsed.node.name, parsed.node.server,
          parsed.node.wsHost, parsed.node.servername
        ].join(' '));
        parsed.line = line;
        items.push(parsed);
      } catch (err) {
        errors.push({ line: index + 1, message: err.message || '无法解析该链接' });
      }
    });

    return { items: items, errors: errors };
  }

  function shareHostForUri(server) {
    return server.indexOf(':') !== -1 && server.charAt(0) !== '[' ? '[' + server + ']' : server;
  }

  function shareLinkForNode(node) {
    var name = encodeURIComponent(node.name);
    var host = shareHostForUri(node.server);
    var params = [];
    var push = function (key, value) {
      if (value !== undefined && value !== null && value !== '') params.push(key + '=' + encodeURIComponent(value));
    };

    if (node.type === 'vless') {
      var tls = !!node.tls || !!node.reality;
      push('encryption', 'none');
      push('security', node.reality ? 'reality' : (tls ? 'tls' : 'none'));
      push('type', node.network || 'tcp');
      if (tls) push('sni', node.servername);
      if (node.fingerprint) push('fp', node.fingerprint);
      if (node.reality) {
        push('pbk', node.publicKey);
        push('sid', node.shortId);
      }
      push('flow', node.flow);
      if (node.network === 'ws') {
        push('path', node.wsPath || '/');
        push('host', node.wsHost);
      }
      if (node.network === 'grpc') push('serviceName', node.grpcService);
      return 'vless://' + node.uuid + '@' + host + ':' + node.port + '?' + params.join('&') + '#' + name;
    }

    if (node.type === 'vmess') {
      var payload = {
        v: '2',
        ps: node.name,
        add: node.server,
        port: String(node.port),
        id: node.uuid,
        aid: '0',
        scy: 'auto',
        net: node.network || 'tcp',
        type: 'none',
        host: node.wsHost || '',
        path: node.network === 'grpc' ? (node.grpcService || '') : (node.wsPath || '/'),
        tls: node.tls ? 'tls' : '',
        sni: node.servername || ''
      };
      return 'vmess://' + encodeBase64Text(JSON.stringify(payload));
    }

    if (node.type === 'trojan') {
      push('security', 'tls');
      push('sni', node.sni);
      if (node.skipCertVerify) push('allowInsecure', '1');
      return 'trojan://' + encodeURIComponent(node.password) + '@' + host + ':' + node.port +
        (params.length ? '?' + params.join('&') : '') + '#' + name;
    }

    if (node.type === 'hysteria2') {
      push('sni', node.sni);
      if (node.skipCertVerify) push('insecure', '1');
      push('up', node.up);
      push('down', node.down);
      return 'hysteria2://' + encodeURIComponent(node.password) + '@' + host + ':' + node.port + '/?' +
        params.join('&') + '#' + name;
    }

    if (node.type === 'ss') {
      return 'ss://' + encodeBase64Url(node.cipher + ':' + node.password) + '@' + host + ':' + node.port + '#' + name;
    }

    throw new Error('暂不支持导出 ' + node.type + ' 协议');
  }

  function copyShareLink(node) {
    if (!node) return;
    var link;
    try {
      link = shareLinkForNode(node);
    } catch (err) {
      toast(err.message || '生成分享链接失败', 'error');
      return;
    }
    copyText(link, '分享链接已复制');
  }

  function linkRegionFor(item) {
    var override = el.linksRegion ? el.linksRegion.value : 'auto';
    var region = override === 'auto' ? item.node.region : override;
    return REGION_META[region] || REGION_META.other;
  }

  function renderLinksFeedback(overflow) {
    var errors = state.linksErrors || [];
    var hasErrors = errors.length > 0;
    if (!hasErrors && !overflow) {
      el.linksFeedback.hidden = true;
      el.linksFeedback.innerHTML = '';
      return;
    }
    var html = '';
    if (hasErrors) {
      html += '<div class="links-feedback-head">' + icon('alert') + '<strong>已跳过 ' + errors.length + ' 条链接</strong></div>';
      html += '<ul class="links-error-list">' + errors.slice(0, 6).map(function (error) {
        return '<li><span>第 ' + error.line + ' 行</span>' + esc(error.message) + '</li>';
      }).join('') + '</ul>';
      if (errors.length > 6) html += '<p class="links-error-more">以及另外 ' + (errors.length - 6) + ' 条，请修正后重新粘贴。</p>';
    }
    if (overflow) {
      html += '<p class="links-overflow">' + icon('alert') + '<span>节点数量将超过上限 ' + nodeLimit() + ' 个，请减少导入条数。</span></p>';
    }
    el.linksFeedback.innerHTML = html;
    el.linksFeedback.hidden = false;
  }

  function renderLinksResults() {
    if (!el.linksPreview) return;
    var items = state.linksParsed || [];
    var errors = state.linksErrors || [];
    var room = personalRoom();
    var overflow = items.length > room;

    if (el.linksSummary) {
      if (!el.linksInput || !el.linksInput.value.trim()) el.linksSummary.textContent = '等待粘贴';
      else if (items.length) el.linksSummary.textContent = items.length + ' 条可导入' + (errors.length ? ' · ' + errors.length + ' 条跳过' : '');
      else el.linksSummary.textContent = '未识别到可用链接';
    }

    renderLinksFeedback(overflow);

    if (!items.length) {
      el.linksPreview.innerHTML = '<div class="links-empty">' +
        '<span class="links-empty-icon">' + icon('link') + '</span>' +
        '<p>粘贴链接后，这里会显示可导入的节点。</p>' +
        (errors.length ? '<small>请检查链接是否包含完整的服务器、端口与凭据。</small>' : '') +
        '</div>';
    } else {
      el.linksPreview.innerHTML = items.map(function (item, index) {
        var region = linkRegionFor(item);
        var type = TYPE_META[item.node.type] || { label: item.node.type };
        var meta = item.node.server + ':' + item.node.port + ' · ' + region.group;
        return '<div class="link-item">' +
          '<span class="link-kind t-' + esc(item.node.type) + '">' + esc(type.label) + '</span>' +
          '<span class="link-main">' +
            '<span class="link-name">' + esc(item.node.name) + '</span>' +
            '<span class="link-meta">' + esc(meta) + '</span>' +
          '</span>' +
          '<span class="link-region">' + (item.node.region === 'other' && el.linksRegion.value === 'auto' ? '未分组' : region.short) + '</span>' +
          '<button class="icon-btn link-remove" type="button" data-link-remove="' + index + '" title="移除" aria-label="移除 ' + esc(item.node.name) + '">' + icon('close') + '</button>' +
        '</div>';
      }).join('');
    }

    if (el.linksConfirm) {
      el.linksConfirm.disabled = !items.length || overflow;
      el.linksConfirm.textContent = items.length ? '导入 ' + items.length + ' 个节点' : '导入节点';
    }

    if (el.linksFootNote) {
      if (errors.length) el.linksFootNote.textContent = '已跳过 ' + errors.length + ' 条无法识别的链接';
      else if (!items.length) el.linksFootNote.textContent = '导入后可在节点管理中继续编辑';
      else el.linksFootNote.textContent = '命名冲突会自动追加序号';
    }
  }

  function parseLinksInput() {
    var result = parseShareLinks(el.linksInput.value);
    state.linksParsed = result.items;
    state.linksErrors = result.errors;
    renderLinksResults();
  }

  function renderLinksExport() {
    if (!el.linksExport) return;
    var list = enabledNodes();
    var lines = [];
    list.forEach(function (node) {
      try {
        lines.push(shareLinkForNode(node));
      } catch (err) {
        /* skip unsupported node */
      }
    });
    state.linksExportText = lines.join('\\n');
    el.linksExport.textContent = state.linksExportText || '没有已启用的节点，暂无可导出的链接。';
    el.linksExport.classList.toggle('is-empty', !state.linksExportText);
    if (el.linksExportCount) el.linksExportCount.textContent = lines.length + ' 条';
    if (el.linksCopyAll) el.linksCopyAll.disabled = !state.linksExportText;
    if (el.linksDownload) el.linksDownload.disabled = !state.linksExportText;
    if (el.linksFootNote) el.linksFootNote.textContent = lines.length ? '链接在本地生成，不会上传服务器' : '先启用至少一个节点';
  }

  function setLinksTab(tab) {
    state.linksTab = tab === 'export' ? 'export' : 'import';
    (el.linksTabs || []).forEach(function (button) {
      var active = button.dataset.tab === state.linksTab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    (el.linksPanels || []).forEach(function (panel) {
      panel.hidden = panel.dataset.tabPanel !== state.linksTab;
    });
    var footerCancel = $('.links-foot-actions [data-close-modal="links"]', el.linksLayer);
    if (footerCancel) footerCancel.textContent = state.linksTab === 'export' ? '关闭' : '取消';
    if (el.linksConfirm) el.linksConfirm.hidden = state.linksTab === 'export';
    if (state.linksTab === 'export') renderLinksExport();
    else {
      if (el.linksInput && el.linksInput.value.trim()) parseLinksInput();
      else renderLinksResults();
    }
  }

  function openLinks(tab) {
    if (!state.config) return;
    setLinksTab(tab || 'import');
    openModal('links');
    window.setTimeout(function () {
      if (state.linksTab === 'import' && el.linksInput) el.linksInput.focus();
    }, 160);
  }

  async function importLinks() {
    if (!ensureWritable() || state.mutating) return;
    var items = state.linksParsed || [];
    if (!items.length) return;
    var room = personalRoom();
    if (items.length > room) {
      toast('最多还能导入 ' + Math.max(room, 0) + ' 个节点', 'error');
      return;
    }
    var override = el.linksRegion.value;
    var additions = items.map(function (item) {
      var copy = Object.assign({}, item.node);
      if (override !== 'auto') copy.region = override;
      copy.id = newNodeId();
      copy.enabled = true;
      copy.showInMain = true;
      copy.tags = [];
      return copy;
    });

    el.linksConfirm.disabled = true;
    el.linksConfirm.textContent = '导入中…';
    var ok = await saveNodes(nodes().concat(additions), {
      successMessage: '已导入 ' + additions.length + ' 个节点'
    });
    el.linksConfirm.textContent = '导入 ' + items.length + ' 个节点';
    el.linksConfirm.disabled = false;
    if (ok) {
      state.linksParsed = [];
      state.linksErrors = [];
      state.linksExportText = '';
      el.linksInput.value = '';
      renderLinksResults();
      closeModal('links');
      switchView('nodes');
    } else {
      parseLinksInput();
    }
  }

  function downloadLinks() {
    if (!state.linksExportText) return;
    var blob = new Blob([state.linksExportText], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'transit-hub-links-' + backupStamp() + '.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('链接清单已开始下载', 'success');
  }

  /* ------------------------------------------------------------------ */
  /* drawer                                                              */
  /* ------------------------------------------------------------------ */

  function setField(input, value) {
    if (input) input.value = value === null || value === undefined ? '' : String(value);
  }

  function getSwitch(button) {
    return button.getAttribute('aria-checked') === 'true';
  }

  function setSwitch(button, on) {
    if (button) button.setAttribute('aria-checked', on ? 'true' : 'false');
  }

  function setSegment(container, value) {
    if (!container) return;
    var buttons = $$('button[data-value]', container);
    var has = buttons.some(function (button) { return button.dataset.value === value; });
    if (!has) value = buttons.length ? buttons[0].dataset.value : '';
    buttons.forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.value === value);
    });
  }

  function segmentValue(container) {
    var active = $('button.is-active', container);
    return active ? active.dataset.value : '';
  }

  function setTags(tags) {
    var values = Array.isArray(tags) ? tags : [];
    $$('input', el.tagGrid).forEach(function (input) {
      var on = values.indexOf(input.value) !== -1;
      input.checked = on;
      input.closest('.tag-chip').classList.toggle('is-on', on);
    });
  }

  function selectedTags() {
    return $$('input:checked', el.tagGrid).map(function (input) { return input.value; });
  }

  function showDrawer() {
    window.clearTimeout(showDrawer.timer);
    el.drawerLayer.hidden = false;
    window.requestAnimationFrame(function () {
      el.drawerLayer.classList.add('is-open');
      syncBodyLock();
    });
  }

  function restoreDrawerFocus() {
    var target = state.drawerFocus;
    state.drawerFocus = null;
    if (!el.app.hidden && target && document.contains(target) && target.offsetParent !== null) {
      target.focus({ preventScroll: true });
    }
  }

  function closeDrawer(immediate) {
    if (!el.drawerLayer || el.drawerLayer.hidden) return;
    el.drawerLayer.classList.remove('is-open');
    window.clearTimeout(showDrawer.timer);
    if (immediate) {
      el.drawerLayer.hidden = true;
      syncBodyLock();
      restoreDrawerFocus();
    } else {
      showDrawer.timer = window.setTimeout(function () {
        el.drawerLayer.hidden = true;
        syncBodyLock();
        restoreDrawerFocus();
      }, 220);
    }
    state.editingId = null;
  }

  function openEditor(id) {
    if (!ensureWritable()) return;
    var node = id ? findNode(id) : null;
    if (id && !node) {
      toast('节点不存在，请刷新后重试', 'error');
      return;
    }
    if (id && !editableNode(node)) {
      toast('共享节点由所有者维护；添加自己的节点后可以随时修改', 'info');
      return;
    }

    clearFormErrors();
    setField(el.fieldName, '');
    setField(el.fieldServer, '');
    setField(el.fieldRegion, 'hk');
    setTags([]);
    setSwitch(el.fieldEnabled, true);
    setSwitch(el.fieldShowMain, true);

    var preset = currentDefaults();
    setField(el.fieldPort, preset.vlessPort || 443);
    setField(el.fieldUuid, preset.vlessUuid || generateUuid());
    setSegment(el.networkBox, 'tcp');
    setSwitch(el.fieldTls, true);
    setSwitch(el.fieldReality, false);
    setField(el.fieldPbk, preset.vlessPublicKey || '');
    setField(el.fieldSid, preset.vlessShortId || '');
    setField(el.fieldSni, preset.vlessServername || '');
    setField(el.fieldFp, 'chrome');
    setField(el.fieldFlow, '');
    setField(el.fieldWsPath, '/');
    setField(el.fieldWsHost, '');
    setField(el.fieldGrpc, '');
    setSwitch(el.fieldUdp, true);

    setField(el.vmUuid, generateUuid());
    setSegment(el.vmNetworkBox, 'ws');
    setSwitch(el.vmTls, false);
    setField(el.vmSni, '');
    setField(el.vmWsPath, '/');
    setField(el.vmWsHost, '');
    setField(el.vmGrpc, '');
    setSwitch(el.vmUdp, true);

    setField(el.trPassword, generatePassword());
    setField(el.trSni, '');
    setSwitch(el.trSkip, false);
    setSwitch(el.trUdp, true);

    setField(el.hyPassword, generatePassword());
    setField(el.hySni, 'bing.com');
    setField(el.hyUp, '80 mbps');
    setField(el.hyDown, '500 mbps');
    setSwitch(el.hySkip, false);

    setField(el.ssCipher, 'aes-256-gcm');
    setField(el.ssPassword, generatePassword());
    setSwitch(el.ssUdp, true);

    var type = node && TYPE_META[node.type] ? node.type : 'vless';
    state.formType = type;
    state.editingId = node ? node.id : null;

    if (node) {
      setField(el.fieldName, node.name);
      setField(el.fieldServer, node.server);
      setField(el.fieldPort, node.port);
      setField(el.fieldRegion, node.region || 'other');
      setTags(node.tags || []);
      setSwitch(el.fieldEnabled, node.enabled !== false);
      setSwitch(el.fieldShowMain, node.showInMain !== false);

      if (type === 'vless') {
        setField(el.fieldUuid, node.uuid || generateUuid());
        setSegment(el.networkBox, node.network || 'tcp');
        setSwitch(el.fieldTls, node.tls !== false);
        setSwitch(el.fieldReality, !!node.reality);
        setField(el.fieldPbk, node.publicKey || '');
        setField(el.fieldSid, node.shortId || '');
        setField(el.fieldSni, node.servername || '');
        setField(el.fieldFp, node.fingerprint || 'chrome');
        setField(el.fieldFlow, node.flow || '');
        setField(el.fieldWsPath, node.wsPath || '/');
        setField(el.fieldWsHost, node.wsHost || '');
        setField(el.fieldGrpc, node.grpcService || '');
        setSwitch(el.fieldUdp, node.udp !== false);
      } else if (type === 'vmess') {
        setField(el.vmUuid, node.uuid || generateUuid());
        setSegment(el.vmNetworkBox, node.network || 'ws');
        setSwitch(el.vmTls, !!node.tls);
        setField(el.vmSni, node.servername || '');
        setField(el.vmWsPath, node.wsPath || '/');
        setField(el.vmWsHost, node.wsHost || '');
        setField(el.vmGrpc, node.grpcService || '');
        setSwitch(el.vmUdp, node.udp !== false);
      } else if (type === 'trojan') {
        setField(el.trPassword, node.password || '');
        setField(el.trSni, node.sni || '');
        setSwitch(el.trSkip, node.skipCertVerify === true);
        setSwitch(el.trUdp, node.udp !== false);
      } else if (type === 'hysteria2') {
        setField(el.hyPassword, node.password || '');
        setField(el.hySni, node.sni || '');
        setField(el.hyUp, node.up || '');
        setField(el.hyDown, node.down || '');
        setSwitch(el.hySkip, node.skipCertVerify === true);
      } else if (type === 'ss') {
        setField(el.ssCipher, node.cipher || 'aes-256-gcm');
        setField(el.ssPassword, node.password || '');
        setSwitch(el.ssUdp, node.udp !== false);
      }
    }

    el.drawerTitle.textContent = node ? '编辑节点' : '添加节点';
    el.drawerSub.textContent = node ? '正在编辑「' + node.name + '」' : '配置一个新的代理节点';
    el.nodeSaveLabel.textContent = node ? '保存更改' : '保存节点';

    renderFormType();
    state.drawerFocus = document.activeElement;
    showDrawer();
    window.setTimeout(function () {
      el.fieldName.focus();
      el.fieldName.select();
    }, 120);
  }

  function renderFormType() {
    var type = state.formType;
    $$('.proto-section').forEach(function (section) {
      section.hidden = section.id !== 'proto-' + type;
    });
    $$('.type-card', el.typeGrid).forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.type === type);
      button.setAttribute('aria-pressed', button.dataset.type === type ? 'true' : 'false');
    });
    syncFormConditions();
  }

  function syncFormConditions() {
    if (state.formType === 'vless') {
      var network = segmentValue(el.networkBox);
      var tls = getSwitch(el.fieldTls);
      if (network !== 'tcp' || !tls) {
        setSwitch(el.fieldReality, false);
        el.realityRow.hidden = true;
      } else {
        el.realityRow.hidden = false;
      }
      var reality = getSwitch(el.fieldReality);
      el.realityFields.hidden = !reality;
      el.tlsFields.hidden = !(tls || reality);
      el.flowField.hidden = !(network === 'tcp' && (tls || reality));
      el.wsFields.hidden = network !== 'ws';
      el.grpcFields.hidden = network !== 'grpc';
      el.fieldFlow.disabled = el.flowField.hidden;
    } else if (state.formType === 'vmess') {
      var vmNetwork = segmentValue(el.vmNetworkBox);
      var vmTls = getSwitch(el.vmTls);
      el.vmTlsField.hidden = !vmTls;
      el.vmWsFields.hidden = vmNetwork !== 'ws';
      el.vmGrpcFields.hidden = vmNetwork !== 'grpc';
    }
  }

  function setSaveBusy(busy) {
    el.nodeSave.disabled = busy;
    el.nodeSave.classList.toggle('is-loading', busy);
    el.nodeSaveSpinner.hidden = !busy;
    el.nodeSaveLabel.textContent = busy
      ? '保存中…'
      : (state.editingId ? '保存更改' : '保存节点');
  }

  function clearFormErrors() {
    $$('.field.has-error', el.nodeForm).forEach(function (field) { field.classList.remove('has-error'); });
    $$('.field-error', el.nodeForm).forEach(function (error) { error.textContent = ''; });
    $$('[aria-invalid="true"]', el.nodeForm).forEach(function (input) { input.removeAttribute('aria-invalid'); });
    el.formGlobalError.hidden = true;
    el.formGlobalError.textContent = '';
  }

  function clearFieldError(event) {
    var field = event.target.closest ? event.target.closest('.field') : null;
    if (field) {
      field.classList.remove('has-error');
      $$('.field-error', field).forEach(function (error) { error.textContent = ''; });
      $$('[aria-invalid="true"]', field).forEach(function (input) { input.removeAttribute('aria-invalid'); });
    }
    if (!el.formGlobalError.hidden) {
      el.formGlobalError.hidden = true;
      el.formGlobalError.textContent = '';
    }
  }

  function showFormErrors(errors) {
    clearFormErrors();
    var globalMessage = '';
    var firstInput = null;
    (errors || []).forEach(function (error) {
      var target = $('[data-error="' + error.key + '"]', el.nodeForm);
      if (!target) {
        if (!globalMessage) globalMessage = error.message;
        return;
      }
      var field = target.closest('.field');
      field.classList.add('has-error');
      target.textContent = error.message;
      var fieldInput = $('input, select', field);
      if (fieldInput) fieldInput.setAttribute('aria-invalid', 'true');
      if (!firstInput) firstInput = fieldInput;
    });
    if (globalMessage) {
      el.formGlobalError.textContent = globalMessage;
      el.formGlobalError.hidden = false;
    }
    if (firstInput) {
      firstInput.focus({ preventScroll: true });
      firstInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (globalMessage) {
      el.formGlobalError.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function hostError(value, key, label, required, errors) {
    var text = String(value || '').trim();
    if (!text) {
      if (required) errors.push({ key: key, message: label + '不能为空' });
      return '';
    }
    if (text.length > 253) {
      errors.push({ key: key, message: label + '不能超过 253 个字符' });
      return text;
    }
    if (CONTROL_RE.test(text) || !HOST_RE.test(text)) {
      errors.push({ key: key, message: label + '只能包含域名、IPv4 或 IPv6 地址' });
      return text;
    }
    return text;
  }

  function requiredError(value, key, label, max, errors) {
    var text = String(value || '').trim();
    if (!text) {
      errors.push({ key: key, message: label + '不能为空' });
      return '';
    }
    if (text.length > max) {
      errors.push({ key: key, message: label + '不能超过 ' + max + ' 个字符' });
      return text;
    }
    if (CONTROL_RE.test(text)) {
      errors.push({ key: key, message: label + '包含非法字符' });
      return text;
    }
    return text;
  }

  function optionalError(value, key, label, max, errors) {
    var text = String(value || '').trim();
    if (!text) return '';
    if (text.length > max) {
      errors.push({ key: key, message: label + '不能超过 ' + max + ' 个字符' });
      return text;
    }
    if (CONTROL_RE.test(text)) {
      errors.push({ key: key, message: label + '包含非法字符' });
      return text;
    }
    return text;
  }

  function collectForm() {
    var errors = [];
    var type = state.formType;
    var name = requiredError(el.fieldName.value, 'name', '节点名称', 80, errors);
    var nameLower = name.toLowerCase();
    var duplicate = nodes().some(function (node) {
      return node.name.toLowerCase() === nameLower && node.id !== state.editingId;
    });
    if (name && RESERVED_NAMES.has(name)) {
      errors.push({ key: 'name', message: '该名称与策略组或内置策略重名，请更换' });
    } else if (name && duplicate) {
      errors.push({ key: 'name', message: '节点名称已存在，请使用其他名称' });
    }

    var server = hostError(el.fieldServer.value, 'server', '服务器地址', true, errors);
    var portRaw = String(el.fieldPort.value || '').trim();
    var port = Number(portRaw);
    if (!portRaw || !Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push({ key: 'port', message: '端口必须是 1 - 65535 之间的整数' });
    }

    var region = el.fieldRegion.value;
    if (REGION_ORDER.indexOf(region) === -1) region = 'other';
    var node = {
      name: name,
      type: type,
      server: server,
      port: port,
      region: region,
      enabled: getSwitch(el.fieldEnabled),
      showInMain: getSwitch(el.fieldShowMain),
      tags: selectedTags()
    };

    var optionalHost = function (value, key, label) {
      return hostError(value, key, label, false, errors);
    };
    var optionalText = function (value, key, label) {
      return optionalError(value, key, label, 256, errors);
    };

    if (type === 'vless') {
      var uuid = requiredError(el.fieldUuid.value, 'uuid', 'UUID', 64, errors);
      if (uuid && !UUID_RE.test(uuid)) errors.push({ key: 'uuid', message: 'UUID 格式不正确' });
      var network = segmentValue(el.networkBox) || 'tcp';
      var reality = getSwitch(el.fieldReality);
      if (reality && network !== 'tcp') {
        errors.push({ key: 'network', message: 'Reality 仅支持 TCP 传输' });
      }
      node.uuid = uuid.toLowerCase();
      node.network = network;
      node.tls = getSwitch(el.fieldTls) || reality;
      node.reality = reality;
      node.servername = optionalHost(el.fieldSni.value, 'servername', 'SNI / 回落域名');
      if (reality) {
        node.publicKey = requiredError(el.fieldPbk.value, 'publicKey', 'Reality 公钥', 128, errors);
        node.shortId = optionalError(el.fieldSid.value, 'shortId', 'Reality Short ID', 32, errors);
      }
      node.flow = network === 'tcp' && (node.tls || reality) ? (el.fieldFlow.value || '') : '';
      node.fingerprint = el.fieldFp.value || 'chrome';
      node.udp = getSwitch(el.fieldUdp);
      if (network === 'ws') {
        node.wsPath = optionalText(el.fieldWsPath.value, 'wsPath', 'WS Path') || '/';
        node.wsHost = optionalHost(el.fieldWsHost.value, 'wsHost', 'WS Host');
      }
      if (network === 'grpc') {
        node.grpcService = optionalError(el.fieldGrpc.value, 'grpcService', 'gRPC 服务名', 64, errors);
      }
    } else if (type === 'vmess') {
      var vmUuid = requiredError(el.vmUuid.value, 'vmUuid', 'UUID', 64, errors);
      if (vmUuid && !UUID_RE.test(vmUuid)) errors.push({ key: 'vmUuid', message: 'UUID 格式不正确' });
      var vmNetwork = segmentValue(el.vmNetworkBox) || 'ws';
      node.uuid = vmUuid.toLowerCase();
      node.network = vmNetwork;
      node.tls = getSwitch(el.vmTls);
      node.servername = optionalHost(el.vmSni.value, 'vmServername', 'SNI');
      node.udp = getSwitch(el.vmUdp);
      if (vmNetwork === 'ws') {
        node.wsPath = optionalText(el.vmWsPath.value, 'vmWsPath', 'WS Path') || '/';
        node.wsHost = optionalHost(el.vmWsHost.value, 'vmWsHost', 'WS Host');
      }
      if (vmNetwork === 'grpc') {
        node.grpcService = optionalError(el.vmGrpc.value, 'vmGrpcService', 'gRPC 服务名', 64, errors);
      }
    } else if (type === 'trojan') {
      node.password = requiredError(el.trPassword.value, 'trPassword', '密码', 128, errors);
      node.sni = optionalHost(el.trSni.value, 'trSni', 'SNI');
      node.skipCertVerify = getSwitch(el.trSkip);
      node.udp = getSwitch(el.trUdp);
    } else if (type === 'hysteria2') {
      node.password = requiredError(el.hyPassword.value, 'hyPassword', '密码', 128, errors);
      node.sni = optionalHost(el.hySni.value, 'hySni', 'SNI');
      node.skipCertVerify = getSwitch(el.hySkip);
      var up = optionalError(el.hyUp.value, 'hyUp', '上行带宽', 24, errors);
      var down = optionalError(el.hyDown.value, 'hyDown', '下行带宽', 24, errors);
      if (up && !BANDWIDTH_RE.test(up)) errors.push({ key: 'hyUp', message: '格式应为 80 mbps' });
      if (down && !BANDWIDTH_RE.test(down)) errors.push({ key: 'hyDown', message: '格式应为 500 mbps' });
      node.up = up;
      node.down = down;
    } else if (type === 'ss') {
      node.cipher = el.ssCipher.value || 'aes-256-gcm';
      node.password = requiredError(el.ssPassword.value, 'ssPassword', '密码', 128, errors);
      node.udp = getSwitch(el.ssUdp);
    }

    return { node: node, errors: errors };
  }

  function apiFieldKey(field) {
    var maps = {
      // 服务端的 reality 校验（如「Reality 仅支持 TCP」）没有专属锚点，统一标到传输方式字段
      vless: { reality: 'network' },
      vmess: { uuid: 'vmUuid', servername: 'vmServername', wsHost: 'vmWsHost', wsPath: 'vmWsPath', grpcService: 'vmGrpcService' },
      trojan: { password: 'trPassword', sni: 'trSni' },
      hysteria2: { password: 'hyPassword', sni: 'hySni', up: 'hyUp', down: 'hyDown' },
      ss: { password: 'ssPassword' }
    };
    if (field === 'name' || field === 'server' || field === 'port') return field;
    var map = maps[state.formType];
    return map && map[field] ? map[field] : field;
  }

  async function submitForm(event) {
    event.preventDefault();
    if (state.mutating) return;
    if (!ensureWritable()) return;
    clearFormErrors();
    var result = collectForm();
    if (result.errors.length) {
      showFormErrors(result.errors);
      return;
    }

    var nextNodes;
    if (state.editingId) {
      if (!editableNode(findNode(state.editingId))) {
        el.formGlobalError.textContent = '共享节点由所有者维护，不能在这里修改';
        el.formGlobalError.hidden = false;
        return;
      }
      nextNodes = nodes().map(function (node) {
        return node.id === state.editingId ? Object.assign({}, result.node, { id: node.id }) : node;
      });
    } else {
      var limit = nodeLimit();
      if (personalNodes().length >= limit) {
        el.formGlobalError.textContent = '节点数量已达到上限 ' + limit + ' 个';
        el.formGlobalError.hidden = false;
        return;
      }
      nextNodes = nodes().concat([Object.assign({}, result.node, { id: newNodeId() })]);
    }

    await saveNodes(nextNodes, {
      form: true,
      successMessage: state.editingId ? '节点已更新' : '节点已添加'
    });
  }

  /* ------------------------------------------------------------------ */
  /* preview                                                             */
  /* ------------------------------------------------------------------ */

  function appGroupCount(app) {
    return enabledNodes().filter(function (node) {
      return (node.tags || []).indexOf(app.key) !== -1;
    }).length;
  }

  function renderPreviewGroups() {
    if (!el.previewGroupPills) return;
    if (!state.config) {
      el.previewGroupPills.innerHTML = '<span class="group-pill is-zero">等待配置载入</span>';
      return;
    }
    var enabled = enabledNodes();
    var defs = [{
      name: MAIN_GROUP,
      count: enabled.filter(function (node) { return node.showInMain !== false; }).length
    }];
    GROUP_REGIONS.forEach(function (region) {
      var count = enabled.filter(function (node) { return node.region === region; }).length;
      if (count) defs.push({ name: REGION_META[region].group, count: count });
    });
    APP_GROUPS.forEach(function (app) {
      defs.push({ name: app.name, count: appGroupCount(app), unit: ' 个标记节点' });
    });
    el.previewGroupPills.innerHTML = defs.map(function (item) {
      return '<span class="group-pill' + (item.count ? '' : ' is-zero') + '" title="' + esc(item.name) + ' · ' + item.count + (item.unit || ' 个节点') + '">' +
        '<span class="group-pill-name">' + esc(item.name) + '</span><b>' + item.count + '</b></span>';
    }).join('');
  }

  function loadPreview(force) {
    if (state.previewLoading) return state.previewPromise;
    if (!force && state.preview && !state.previewDirty) return Promise.resolve(state.preview);
    state.previewLoading = true;
    el.codeLoading.hidden = false;
    el.previewRefresh.disabled = true;

    state.previewPromise = (async function () {
      try {
        var text = await request('/api/preview', { raw: true });
        state.preview = text;
        state.previewDirty = false;
        renderPreview();
        return text;
      } catch (err) {
        if (err.status === 401) {
          handleUnauthorized();
        } else {
          toast(err.message || '生成订阅预览失败', 'error');
          if (!state.preview) {
            el.yamlCode.innerHTML = '<div class="code-line"><span class="ln">!</span><span class="lc tok-comment">' + esc(err.message || '生成订阅预览失败') + '</span></div>';
            el.codeLines.textContent = '0 行';
            el.codeSize.textContent = '0 KB';
          }
        }
        return null;
      } finally {
        state.previewLoading = false;
        el.codeLoading.hidden = true;
        el.previewRefresh.disabled = false;
      }
    })();
    return state.previewPromise;
  }

  function renderPreview(options) {
    var opts = options || {};
    var text = state.preview || '';
    var keepScroll = opts.preserveScroll ? el.codeBody.scrollTop : 0;
    el.yamlCode.innerHTML = highlightYaml(text);
    var lines = text ? text.split('\\n').length : 0;
    var bytes = new TextEncoder().encode(text).length;
    el.codeLines.textContent = lines + ' 行';
    el.codeSize.textContent = (bytes / 1024).toFixed(1) + ' KB';
    el.codeBody.scrollTop = keepScroll;
    applyPreviewSearch();
  }

  function previewTextNodes(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var list = [];
    var node = walker.nextNode();
    while (node) {
      list.push(node);
      node = walker.nextNode();
    }
    return list;
  }

  function previewPosition(nodes, offsets, position) {
    for (var i = 0; i < nodes.length; i++) {
      var start = offsets[i];
      var end = start + nodes[i].nodeValue.length;
      if (position >= start && position <= end) {
        if (position === start && position === end) continue;
        return { node: nodes[i], offset: Math.min(position - start, nodes[i].nodeValue.length) };
      }
    }
    return null;
  }

  function markLineMatches(line, query) {
    var text = line.textContent || '';
    var haystack = text.toLowerCase();
    var needle = query.toLowerCase();
    var index = haystack.indexOf(needle);
    if (index === -1) return 0;

    var nodes = previewTextNodes(line).filter(function (node) {
      return node.nodeValue.length > 0;
    });
    if (!nodes.length) return 0;
    var offsets = [];
    var total = 0;
    nodes.forEach(function (node) {
      offsets.push(total);
      total += node.nodeValue.length;
    });

    var ranges = [];
    while (index !== -1) {
      var start = previewPosition(nodes, offsets, index);
      var end = previewPosition(nodes, offsets, index + needle.length);
      if (start && end) {
        var range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        ranges.push(range);
      }
      index = haystack.indexOf(needle, index + needle.length);
    }

    for (var i = ranges.length - 1; i >= 0; i--) {
      var mark = document.createElement('mark');
      mark.className = 'code-hit';
      mark.appendChild(ranges[i].extractContents());
      ranges[i].insertNode(mark);
    }
    return ranges.length;
  }

  function applyPreviewSearch() {
    state.previewHits = [];
    state.previewHitIndex = -1;
    var query = state.previewQuery.trim();
    if (query) {
      $$('.lc', el.yamlCode).forEach(function (line) {
        markLineMatches(line, query);
      });
      state.previewHits = $$('mark.code-hit', el.yamlCode);
      if (state.previewHits.length) setPreviewHit(0);
    }
    updatePreviewSearchUi();
  }

  function updatePreviewSearchUi() {
    if (!el.previewSearchCount) return;
    var hasQuery = state.previewQuery.trim().length > 0;
    var total = state.previewHits.length;
    el.previewSearchCount.textContent = !hasQuery
      ? ''
      : (total ? (state.previewHitIndex + 1) + ' / ' + total : '无匹配');
    el.previewSearchCount.classList.toggle('is-empty', hasQuery && !total);
    if (el.previewSearchPrev) el.previewSearchPrev.disabled = total < 2;
    if (el.previewSearchNext) el.previewSearchNext.disabled = total < 2;
  }

  function setPreviewHit(index) {
    var total = state.previewHits.length;
    if (!total) return;
    var next = ((index % total) + total) % total;
    state.previewHits.forEach(function (mark, i) {
      mark.classList.toggle('is-current', i === next);
    });
    state.previewHitIndex = next;
    updatePreviewSearchUi();

    var mark = state.previewHits[next];
    if (!mark || !el.codeBody) return;
    var bodyRect = el.codeBody.getBoundingClientRect();
    var rect = mark.getBoundingClientRect();
    if (rect.top < bodyRect.top + 28 || rect.bottom > bodyRect.bottom - 20) {
      el.codeBody.scrollTop += rect.top - bodyRect.top - el.codeBody.clientHeight / 2 + rect.height / 2;
    }
  }

  function movePreviewHit(delta) {
    if (!state.previewHits.length) return;
    setPreviewHit(state.previewHitIndex < 0 ? 0 : state.previewHitIndex + delta);
  }

  function refreshPreviewSearch() {
    renderPreview({ preserveScroll: true });
  }

  function splitComment(raw) {
    var inDouble = false;
    var inSingle = false;
    for (var i = 0; i < raw.length; i++) {
      var char = raw[i];
      if (char === '"' && !inSingle && raw[i - 1] !== '\\\\') inDouble = !inDouble;
      else if (char === "'" && !inDouble) inSingle = !inSingle;
      else if (char === '#' && !inDouble && !inSingle && (i === 0 || /\\s/.test(raw[i - 1]))) {
        return [raw.slice(0, i), raw.slice(i)];
      }
    }
    return [raw, ''];
  }

  function highlightValue(raw) {
    var parts = splitComment(raw);
    var valuePart = parts[0];
    var commentPart = parts[1];
    var output = '';
    var leading = (valuePart.match(/^\\s*/) || [''])[0];
    var value = valuePart.slice(leading.length);
    if (!value) {
      output = esc(valuePart);
    } else if (/^"(?:\\\\.|[^"\\\\])*"$/.test(value)) {
      output = esc(leading) + '<span class="tok-string">' + esc(value) + '</span>';
    } else if (/^(true|false|null|yes|no)$/i.test(value)) {
      output = esc(leading) + '<span class="tok-bool">' + esc(value) + '</span>';
    } else if (/^-?\\d+(?:\\.\\d+)?$/.test(value)) {
      output = esc(leading) + '<span class="tok-number">' + esc(value) + '</span>';
    } else {
      output = esc(valuePart);
    }
    if (commentPart) output += '<span class="tok-comment">' + esc(commentPart) + '</span>';
    return output;
  }

  function highlightYaml(text) {
    return text.split('\\n').map(function (line, index) {
      var leading = (line.match(/^\\s*/) || [''])[0];
      var rest = line.slice(leading.length);
      var content = '';
      if (rest.charAt(0) === '#') {
        content = esc(leading) + '<span class="tok-comment">' + esc(rest) + '</span>';
      } else {
        var bullet = '';
        if (rest.indexOf('- ') === 0) {
          bullet = '- ';
          rest = rest.slice(2);
        }
        var match = rest.match(/^([A-Za-z0-9_.@\\/-]+):(.*)$/);
        if (match) {
          content = esc(leading + bullet) +
            '<span class="tok-key">' + esc(match[1]) + '</span>:' +
            highlightValue(match[2]);
        } else {
          content = esc(leading + bullet) + highlightValue(rest);
        }
      }
      return '<div class="code-line"><span class="ln">' + (index + 1) + '</span><span class="lc">' + (content || ' ') + '</span></div>';
    }).join('');
  }

  async function copyYaml() {
    var text = state.preview && !state.previewDirty ? state.preview : await loadPreview();
    if (!text) return;
    await copyText(text, 'Clash 配置已复制');
  }

  async function downloadYaml() {
    var text = state.preview && !state.previewDirty ? state.preview : await loadPreview();
    if (!text) return;
    var now = new Date();
    var stamp = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') + '-' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0');
    var blob = new Blob([text], { type: 'text/yaml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'transit-hub-' + stamp + '.yaml';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('配置已开始下载', 'success');
  }

  /* ------------------------------------------------------------------ */
  /* modal, toast, clipboard                                             */
  /* ------------------------------------------------------------------ */

  function syncBodyLock() {
    var open = $$('.drawer-layer.is-open, .modal-layer.is-open').length > 0;
    document.body.classList.toggle('body-lock', open);
  }

  function modalLayer(name) {
    if (name === 'generic') return el.genericLayer;
    if (name === 'kv') return el.kvLayer;
    if (name === 'links') return el.linksLayer;
    return null;
  }

  function modalFocusTarget(name) {
    if (name === 'generic') return el.genericOk;
    if (name === 'kv') return el.kvCopyName;
    if (name === 'links') {
      if (state.linksTab === 'export') return el.linksCopyAll;
      return el.linksInput;
    }
    return null;
  }

  function openModal(name) {
    var layer = modalLayer(name);
    if (!layer) return;
    window.clearTimeout(openModal[name + 'Timer']);
    if (!isLayerOpen(layer)) state.layerFocus[name] = document.activeElement;
    layer.hidden = false;
    window.requestAnimationFrame(function () {
      layer.classList.add('is-open');
      syncBodyLock();
      var focusTarget = modalFocusTarget(name);
      if (focusTarget) window.setTimeout(function () { focusTarget.focus({ preventScroll: true }); }, 120);
    });
  }

  function closeModal(name, immediate) {
    var layer = modalLayer(name);
    if (!layer || layer.hidden) return;
    layer.classList.remove('is-open');
    window.clearTimeout(openModal[name + 'Timer']);
    var finalize = function () {
      layer.hidden = true;
      syncBodyLock();
      var target = state.layerFocus[name];
      state.layerFocus[name] = null;
      if (!el.app.hidden && target && document.contains(target) && target.offsetParent !== null) {
        try { target.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
      }
    };
    if (immediate) {
      finalize();
    } else {
      openModal[name + 'Timer'] = window.setTimeout(finalize, 200);
    }
    if (name === 'generic') {
      state.deletingId = null;
      state.userDeletingId = null;
      confirmCallback = null;
    }
  }

  function isLayerOpen(layer) {
    return !!layer && !layer.hidden && layer.classList.contains('is-open');
  }

  function layerFocusables(layer) {
    return $$('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', layer)
      .filter(function (node) {
        return node.offsetParent !== null && node.getAttribute('aria-hidden') !== 'true';
      });
  }

  function trapLayerFocus(event, layer) {
    var items = layerFocusables(layer);
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    var active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !layer.contains(active)) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      }
    } else if (active === last || !layer.contains(active)) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function toast(message, type, action) {
    var kind = type || 'info';
    var node = document.createElement('div');
    node.className = 'toast toast-' + kind;
    node.innerHTML = icon(kind === 'success' ? 'check' : (kind === 'error' ? 'alert' : 'info'));
    var text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message;
    node.appendChild(text);
    var closing = false;
    var timer = 0;
    var dismiss = function () {
      if (closing) return;
      closing = true;
      window.clearTimeout(timer);
      node.classList.remove('is-show');
      window.setTimeout(function () { node.remove(); }, 240);
    };
    if (action && action.label && typeof action.run === 'function') {
      var actionButton = document.createElement('button');
      actionButton.type = 'button';
      actionButton.className = 'toast-action';
      actionButton.textContent = action.label;
      actionButton.addEventListener('click', function () {
        dismiss();
        action.run();
      });
      node.appendChild(actionButton);
      node.classList.add('has-action');
    }
    el.toasts.appendChild(node);
    while (el.toasts.children.length > 4) el.toasts.removeChild(el.toasts.firstChild);
    window.requestAnimationFrame(function () { node.classList.add('is-show'); });
    timer = window.setTimeout(dismiss, action ? 8000 : 3400);
  }

  async function copyText(text, message) {
    if (!text) {
      toast('没有可复制的内容', 'error');
      return false;
    }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        var area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.select();
        var copied = document.execCommand('copy');
        area.remove();
        if (!copied) throw new Error('copy failed');
      }
      if (message) toast(message, 'success');
      return true;
    } catch (err) {
      toast('复制失败，请手动选择文本后复制', 'error');
      return false;
    }
  }

  function copySubscription() {
    var url = subUrlValue();
    if (!url) {
      toast('尚未配置订阅令牌，请先到设置页填写 AUTH_TOKEN', 'error');
      return;
    }
    copyText(url, '订阅链接已复制');
  }

  /* ------------------------------------------------------------------ */
  /* events                                                              */
  /* ------------------------------------------------------------------ */

  function resetFilters() {
    state.query = '';
    state.filterType = 'all';
    state.filterRegion = 'all';
    if (el.nodeSearch) el.nodeSearch.value = '';
    if (el.filterType) el.filterType.value = 'all';
    if (el.filterRegion) el.filterRegion.value = 'all';
    renderNodeList();
  }

  function bindEvents() {
    /* 单个元素缺失不应中断整条绑定链：这里统一走 on()，元素为空时静默跳过 */
    function on(target, type, handler, options) {
      if (target) target.addEventListener(type, handler, options);
      return target;
    }

    on(el.loginForm, 'submit', submitAuth);
    on(el.loginUsername, 'input', function () { showLoginError(''); });
    on(el.loginPassword, 'input', function () { showLoginError(''); });
    on(el.loginConfirm, 'input', function () { showLoginError(''); });
    on(el.loginSetupToken, 'input', function () { showLoginError(''); });
    on(el.loginToken, 'input', function () { showLoginError(''); });
    on(el.loginPasswordReveal, 'click', function () {
      var showing = el.loginPassword.type === 'text';
      el.loginPassword.type = showing ? 'password' : 'text';
      setRevealState(el.loginPasswordReveal, !showing, '密码');
    });
    on(el.loginTokenReveal, 'click', function () {
      var showing = el.loginToken.type === 'text';
      el.loginToken.type = showing ? 'password' : 'text';
      setRevealState(el.loginTokenReveal, !showing, '令牌');
    });
    on(el.loginRecovery, 'click', function () {
      renderAuthView(state.loginView === 'recovery' ? 'login' : 'recovery');
    });

    el.navItems.forEach(function (button) {
      button.addEventListener('click', function () { switchView(button.dataset.view); });
    });
    $$('[data-goto]').forEach(function (button) {
      button.addEventListener('click', function () { switchView(button.dataset.goto); });
    });
    on(el.heroPreview, 'click', function () { switchView('preview'); });

    [el.nodesAdd, el.heroAdd, el.emptyAdd].forEach(function (button) {
      if (button) button.addEventListener('click', function () { openEditor(null); });
    });
    [el.previewCopySub].forEach(function (button) {
      if (button) button.addEventListener('click', copySubscription);
    });
    [el.nodesLinks, el.emptyLinks].forEach(function (button) {
      if (button) button.addEventListener('click', function () { openLinks('import'); });
    });
    on(el.subCopy, 'click', copySubscription);
    on(el.subReveal, 'click', function () {
      state.subRevealed = !state.subRevealed;
      renderSubUrls();
    });

    [el.themeToggle, el.mobileTheme].forEach(function (button) {
      button.addEventListener('click', toggleTheme);
    });
    if (el.themeMode) {
      on(el.themeMode, 'click', function (event) {
        var button = event.target.closest('[data-theme-mode]');
        if (button) setThemeMode(button.dataset.themeMode);
      });
    }
    on(el.logout, 'click', function () { logout(''); });
    on(el.mobileLogout, 'click', function () { logout(''); });

    if (el.tokenOpenSettings) on(el.tokenOpenSettings, 'click', function () {
      switchView('settings');
      if (el.setAuthToken) {
        window.setTimeout(function () {
          el.setAuthToken.focus();
          el.setAuthToken.select();
        }, 40);
      }
    });
    if (el.emptySubBtn) on(el.emptySubBtn, 'click', function () { switchView('nodes'); });

    [el.storageCard, el.kvHelpSide, el.kvHelpBtn].forEach(function (button) {
      button.addEventListener('click', function () {
        if (button === el.storageCard && state.meta && state.meta.kv && !state.meta.readonly) {
          toast('KV 存储已连接 · 当前配置版本 #' + state.rev, 'success');
        } else {
          openModal('kv');
        }
      });
    });
    on(el.kvCopyName, 'click', function () { copyText('SUB_KV', '变量名 SUB_KV 已复制'); });

    on(el.nodeSearch, 'input', function () {
      state.query = el.nodeSearch.value;
      renderNodeList();
    });
    on(el.filterType, 'change', function () {
      state.filterType = el.filterType.value;
      renderNodeList();
    });
    on(el.filterRegion, 'change', function () {
      state.filterRegion = el.filterRegion.value;
      renderNodeList();
    });
    [el.filterReset, el.emptyReset].forEach(function (button) {
      button.addEventListener('click', resetFilters);
    });

    on(el.nodeList, 'click', function (event) {
      var pick = event.target.closest('[data-pick-id]');
      if (pick) {
        toggleSelection(pick.dataset.pickId, pick.checked, event.shiftKey);
        return;
      }
      var row = event.target.closest('.node-row');
      if (!row) return;
      var menuButton = event.target.closest('[data-menu-id]');
      if (menuButton) {
        openRowMenu(menuButton.dataset.menuId, menuButton);
        return;
      }
      var copyButton = event.target.closest('[data-copy-id]');
      if (copyButton) {
        var copyNode = findNode(copyButton.dataset.copyId);
        if (copyNode) copyText(copyNode.server, '服务器地址已复制');
        return;
      }
      var toggleButton = event.target.closest('[data-toggle-id]');
      if (toggleButton) {
        toggleNode(toggleButton.dataset.toggleId, toggleButton);
        return;
      }
      var moveButton = event.target.closest('[data-move-id]');
      if (moveButton) {
        if (!moveButton.disabled) {
          moveNode(moveButton.dataset.moveId, Number(moveButton.dataset.dir), moveButton);
        }
        return;
      }
      var editButton = event.target.closest('[data-edit-id]');
      if (editButton) {
        openEditor(editButton.dataset.editId);
        return;
      }
      var duplicateButton = event.target.closest('[data-dup-id]');
      if (duplicateButton) {
        duplicateNode(duplicateButton.dataset.dupId);
        return;
      }
      var deleteButton = event.target.closest('[data-del-id]');
      if (deleteButton) {
        askDelete(deleteButton.dataset.delId);
        return;
      }
      if (event.target.closest('button, input, .cell-check')) return;
      openEditor(row.dataset.id);
    });
    on(el.nodeList, 'keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var row = event.target.closest('.node-row');
      if (!row || event.target.closest('button, input, .cell-check')) return;
      event.preventDefault();
      openEditor(row.dataset.id);
    });

    if (el.selectAll) {
      on(el.selectAll, 'change', function () { selectAllVisible(el.selectAll.checked); });
    }
    if (el.bulkBar) {
      on(el.bulkBar, 'click', function (event) {
        var button = event.target.closest('[data-bulk]');
        if (!button || button.disabled) return;
        if (button.dataset.bulk === 'enable') bulkSetEnabled(true);
        else if (button.dataset.bulk === 'disable') bulkSetEnabled(false);
        else if (button.dataset.bulk === 'delete') askBulkDelete();
      });
    }
    if (el.bulkClear) on(el.bulkClear, 'click', clearSelection);
    if (el.bulkRegion) {
      on(el.bulkRegion, 'change', function () {
        if (el.bulkRegion.value) bulkMoveRegion();
      });
    }

    if (el.rowMenu) {
      on(el.rowMenu, 'click', function (event) {
        var item = event.target.closest('[data-menu]');
        if (!item || item.disabled) return;
        performRowMenu(item.dataset.menu);
      });
      on(el.rowMenu, 'keydown', function (event) {
        var items = $$('.menu-item:not([disabled])', el.rowMenu);
        if (!items.length) return;
        var index = items.indexOf(document.activeElement);
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          items[(index + 1) % items.length].focus();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          items[(index - 1 + items.length) % items.length].focus();
        } else if (event.key === 'Home') {
          event.preventDefault();
          items[0].focus();
        } else if (event.key === 'End') {
          event.preventDefault();
          items[items.length - 1].focus();
        } else if (event.key === 'Tab') {
          closeRowMenu(true, false);
        }
      });
      document.addEventListener('click', function (event) {
        if (!el.rowMenu || el.rowMenu.hidden) return;
        if (el.rowMenu.contains(event.target) || event.target.closest('[data-menu-id]')) return;
        closeRowMenu(false, false);
      }, true);
      window.addEventListener('scroll', function () {
        if (el.rowMenu && !el.rowMenu.hidden) closeRowMenu(false, false);
      }, true);
      window.addEventListener('resize', function () {
        if (el.rowMenu && !el.rowMenu.hidden) closeRowMenu(false, false);
      });
    }

    on(el.recentNodes, 'click', function (event) {
      var button = event.target.closest('[data-edit-id]');
      if (button) openEditor(button.dataset.editId);
    });

    $$('[data-close-drawer]').forEach(function (button) {
      button.addEventListener('click', function () { closeDrawer(); });
    });
    $$('[data-close-modal]').forEach(function (button) {
      button.addEventListener('click', function () {
        closeModal(button.dataset.closeModal);
      });
    });

    on(el.nodeForm, 'submit', submitForm);
    on(el.nodeForm, 'input', clearFieldError);
    on(el.nodeForm, 'change', clearFieldError);

    on(el.settingsForm, 'submit', saveSettings);
    on(el.settingsForm, 'input', clearSettingsFieldError);
    on(el.settingsForm, 'change', clearSettingsFieldError);
    if (el.userAdd) on(el.userAdd, 'click', function () { openUserEditor('add'); });
    if (el.userCancel) on(el.userCancel, 'click', closeUserEditor);
    if (el.userForm) {
      on(el.userForm, 'submit', submitUserForm);
      on(el.userForm, 'input', clearUserFieldError);
    }
    if (el.userList) {
      on(el.userList, 'click', function (event) {
        var manage = event.target.closest('[data-user-manage]');
        if (manage) {
          openUserEditor('manage', manage.dataset.userManage);
          return;
        }
        var remove = event.target.closest('[data-user-delete]');
        if (remove && !remove.disabled) askDeleteUser(remove.dataset.userDelete);
      });
    }
    if (el.userRole) {
      on(el.userRole, 'change', function () {
        var role = el.userRole.value === 'owner' ? 'owner' : 'member';
        var previousHidden = el.userScopeField ? el.userScopeField.hidden : false;
        var scope = role === 'owner' || previousHidden ? { allNodes: false, nodeIds: [] } : scopeFromForm();
        renderUserScope(scope, role);
      });
    }
    if (el.userScopeAll) on(el.userScopeAll, 'change', syncScopeControls);
    if (el.passwordForm) {
      on(el.passwordForm, 'submit', submitPasswordChange);
      on(el.passwordForm, 'input', clearPasswordErrors);
    }
    if (el.accountSubCopy) on(el.accountSubCopy, 'click', function () {
      var url = state.meta && state.meta.subUrl;
      if (url) copyText(url, '我的订阅链接已复制');
    });
    on(el.settingsClear, 'click', function () {
      setField(el.setUuid, '');
      setField(el.setPbk, '');
      setField(el.setSid, '');
      setField(el.setSni, '');
      setField(el.setPort, '');
      clearSettingsErrors();
      toast('已清空 VLESS 预设，点击「保存设置」后生效', 'info');
    });
    if (el.genAuthToken) on(el.genAuthToken, 'click', function () {
      setField(el.setAuthToken, generatePassword(32));
      state.clearAuthToken = false;
      clearSettingsErrors();
      el.setAuthToken.focus();
      el.setAuthToken.select();
    });
    if (el.clearAuthToken) on(el.clearAuthToken, 'click', function () {
      state.clearAuthToken = true;
      setField(el.setAuthToken, '');
      clearSettingsErrors();
      toast('已标记清除订阅令牌，点击「保存设置」后生效；未配置环境变量时订阅将需要重新配置', 'info');
    });
    if (el.setAuthToken) on(el.setAuthToken, 'input', function () {
      // 又输入了新值：取消待清除状态
      if (String(el.setAuthToken.value || '').trim()) state.clearAuthToken = false;
    });
    on(el.typeGrid, 'click', function (event) {
      var button = event.target.closest('[data-type]');
      if (!button) return;
      state.formType = button.dataset.type;
      clearFormErrors();
      renderFormType();
    });
    $$('.segmented').forEach(function (group) {
      group.addEventListener('click', function (event) {
        var button = event.target.closest('button[data-value]');
        if (!button) return;
        $$('button', group).forEach(function (item) { item.classList.remove('is-active'); });
        button.classList.add('is-active');
        syncFormConditions();
      });
    });
    $$('#node-form .switch').forEach(function (button) {
      button.addEventListener('click', function () {
        setSwitch(button, !getSwitch(button));
        syncFormConditions();
      });
    });
    $$('#tag-grid input').forEach(function (input) {
      input.addEventListener('change', function () {
        input.closest('.tag-chip').classList.toggle('is-on', input.checked);
      });
    });

    $('#gen-uuid').addEventListener('click', function () { setField(el.fieldUuid, generateUuid()); });
    $('#gen-vm-uuid').addEventListener('click', function () { setField(el.vmUuid, generateUuid()); });
    $('#gen-set-uuid').addEventListener('click', function () { setField(el.setUuid, generateUuid()); });
    $('#gen-tr-password').addEventListener('click', function () { setField(el.trPassword, generatePassword()); });
    $('#gen-hy-password').addEventListener('click', function () { setField(el.hyPassword, generatePassword()); });
    $('#gen-ss-password').addEventListener('click', function () { setField(el.ssPassword, generatePassword()); });

    on(el.genericOk, 'click', function () {
      var callback = confirmCallback;
      confirmCallback = null;
      if (callback) callback();
    });

    on(el.nodesExport, 'click', exportBackup);
    on(el.nodesImport, 'click', function () {
      if (ensureWritable()) el.importFile.click();
    });
    on(el.importFile, 'change', function () {
      var file = el.importFile.files && el.importFile.files[0];
      el.importFile.value = '';
      if (file) importBackupFile(file);
    });
    on(el.previewRefresh, 'click', function () { loadPreview(true); });
    on(el.previewCopy, 'click', copyYaml);
    on(el.previewDownload, 'click', downloadYaml);

    if (el.previewSearch) {
      on(el.previewSearch, 'input', function () {
        state.previewQuery = el.previewSearch.value;
        window.clearTimeout(state.previewSearchTimer);
        state.previewSearchTimer = window.setTimeout(refreshPreviewSearch, 160);
      });
      on(el.previewSearch, 'keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          movePreviewHit(event.shiftKey ? -1 : 1);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          el.previewSearch.value = '';
          state.previewQuery = '';
          window.clearTimeout(state.previewSearchTimer);
          refreshPreviewSearch();
        }
      });
    }
    if (el.previewSearchPrev) on(el.previewSearchPrev, 'click', function () { movePreviewHit(-1); });
    if (el.previewSearchNext) on(el.previewSearchNext, 'click', function () { movePreviewHit(1); });

    (el.linksTabs || []).forEach(function (button) {
      button.addEventListener('click', function () { setLinksTab(button.dataset.tab); });
    });
    if (el.linksInput) {
      on(el.linksInput, 'input', function () {
        window.clearTimeout(state.linksTimer);
        state.linksTimer = window.setTimeout(parseLinksInput, 200);
      });
    }
    if (el.linksRegion) {
      on(el.linksRegion, 'change', function () {
        if (el.linksInput.value.trim()) parseLinksInput();
        else renderLinksResults();
      });
    }
    if (el.linksPreview) {
      on(el.linksPreview, 'click', function (event) {
        var button = event.target.closest('[data-link-remove]');
        if (!button) return;
        var index = Number(button.dataset.linkRemove);
        if (index >= 0 && index < state.linksParsed.length) {
          state.linksParsed.splice(index, 1);
          renderLinksResults();
        }
      });
    }
    if (el.linksConfirm) on(el.linksConfirm, 'click', importLinks);
    if (el.linksCopyAll) on(el.linksCopyAll, 'click', function () { copyText(state.linksExportText, '链接清单已复制'); });
    if (el.linksDownload) on(el.linksDownload, 'click', downloadLinks);

    document.addEventListener('keydown', function (event) {
      var tag = (event.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'select' || tag === 'textarea' || event.target.isContentEditable;

      if (event.key === 'Escape') {
        if (el.rowMenu && !el.rowMenu.hidden) { event.preventDefault(); closeRowMenu(false, true); return; }
        if (isLayerOpen(el.linksLayer)) { closeModal('links'); return; }
        if (isLayerOpen(el.kvLayer)) { closeModal('kv'); return; }
        if (isLayerOpen(el.genericLayer)) { closeModal('generic'); return; }
        if (isLayerOpen(el.drawerLayer)) { closeDrawer(); return; }
      }

      if (!el.app.hidden && event.key === 'Tab') {
        var activeLayer = isLayerOpen(el.linksLayer) ? el.linksLayer
          : (isLayerOpen(el.kvLayer) ? el.kvLayer
            : (isLayerOpen(el.genericLayer) ? el.genericLayer
              : (isLayerOpen(el.drawerLayer) ? el.drawerLayer : null)));
        if (activeLayer) trapLayerFocus(event, activeLayer);
      }

      if (!el.app.hidden && event.key === '/' && !typing) {
        event.preventDefault();
        if (state.view === 'preview') {
          el.previewSearch.focus();
          el.previewSearch.select();
        } else {
          if (state.view !== 'nodes') switchView('nodes');
          window.setTimeout(function () { el.nodeSearch.focus(); el.nodeSearch.select(); }, 30);
        }
        return;
      }

      if (!el.app.hidden && isLayerOpen(el.drawerLayer) && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        el.nodeForm.requestSubmit();
      }
    });
  }

  function init() {
    cacheElements();
    bindEvents();
    applyTheme(themeMode(), false);
    if (window.matchMedia) {
      var scheme = window.matchMedia('(prefers-color-scheme: dark)');
      var onSchemeChange = function () {
        if (themeMode() === 'system') applyTheme('system', false);
      };
      if (scheme.addEventListener) scheme.addEventListener('change', onSchemeChange);
      else if (scheme.addListener) scheme.addListener(onSchemeChange);
    }
    initAuth();
  }

  /* 脚本异常兜底：避免「点了没反应」却毫无提示，把原因直接暴露到界面与控制台 */
  window.addEventListener('error', function (event) {
    var message = (event && event.message) || '未知脚本错误';
    if (typeof console !== 'undefined' && console.error) {
      console.error('[transit-hub]', message, event && event.filename, event && event.lineno);
    }
    if (el.toasts) toast('页面脚本异常：' + message, 'error');
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    var message = reason && reason.message ? reason.message : String(reason || '未知异常');
    if (typeof console !== 'undefined' && console.error) console.error('[transit-hub]', message);
    if (el.toasts) toast('请求异常：' + message, 'error');
  });

  init();
})();
</script>
</body>
</html>
`

class HttpError extends Error {
  constructor(status, message, field) {
    super(message)
    this.status = status
    this.field = field
  }
}

async function handleRequest(request, env) {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '') || '/'

  try {
    if (path.startsWith('/api/')) {
      const limited = await checkApiRateLimit(request, env)
      if (limited) return limited
      return await handleApi(request, url, path, env)
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: baseHeaders() })
    }
    // HEAD 只用于探活：不拼伪装页 HTML，也不返回正文，避免白烧 CPU 且符合 RFC 9110
    const headOnly = request.method === 'HEAD'
    if (path === '/admin' || path === '/console') {
      return serveAdmin(headOnly)
    }
    const token = subscriptionToken(request, url)
    if (token) {
      const limited = await checkSubRateLimit(request, env)
      if (limited) return limited
      const access = await subscriptionAccess(env, token)
      if (access) return await serveSubscription(env, access.config, headOnly)
      // 令牌无效：本次请求已经在上面计过一次，这里不再重复扣配额，
      // 否则爆破者实际可用的次数只有配置值的一半
      return renderDecoy(request, headOnly)
    }
    // 无令牌路径同样限流：伪装页每次都要拼整页 HTML，不能成为免费刷 CPU 的入口
    const decoyLimited = await checkSubRateLimit(request, env)
    if (decoyLimited) return decoyLimited
    return renderDecoy(request, headOnly)
  } catch (err) {
    if (err instanceof HttpError) {
      return json({ error: err.message, field: err.field || null }, err.status)
    }
    console.error(err && err.stack ? err.stack : err)
    return new Response('Internal Server Error', {
      status: 500,
      headers: { ...baseHeaders(), 'content-type': 'text/plain;charset=UTF-8', 'cache-control': 'no-store' },
    })
  }
}

/* ------------------------------------------------------------------ */
/* auth                                                                */
/* ------------------------------------------------------------------ */

let warnedWeakAuthToken = false
function authToken(env) {
  const value = env && env.AUTH_TOKEN
  if (typeof value !== 'string') return ''
  const token = value.trim()
  if (!token) return ''
  // 环境变量可能被误粘入换行或超长内容：这类值既无法与 URL 中的令牌匹配，
  // 也不该被当作有效凭据。过短的令牌等于可爆破，一并按「未配置」处理并提示一次。
  if (token.length < AUTH_TOKEN_MIN || token.length > AUTH_TOKEN_MAX || /[\s\u0000-\u001f\u007f]/.test(token)) {
    if (!warnedWeakAuthToken) {
      warnedWeakAuthToken = true
      console.warn(`AUTH_TOKEN 需为 ${AUTH_TOKEN_MIN}-${AUTH_TOKEN_MAX} 位且不含空白，当前值已忽略；请在设置页生成新令牌`)
    }
    return ''
  }
  return token
}

/* 部署恢复令牌是「绕过登录直接拿所有者权限」的凭据，短到能被爆破就等于没有密码。
   与 AUTH_TOKEN 同一套形态规则：过短 / 含空白 / 含控制字符一律按「未配置」处理，
   只提示一次，避免每个请求都刷日志。 */
let warnedWeakAdminToken = false
function dedicatedAdminToken(env) {
  const value = env && env.ADMIN_TOKEN
  if (typeof value !== 'string') return ''
  const token = value.trim()
  if (!token) return ''
  if (token.length < ADMIN_TOKEN_MIN || token.length > AUTH_TOKEN_MAX || /[\s\u0000-\u001f\u007f]/.test(token)) {
    if (!warnedWeakAdminToken) {
      warnedWeakAdminToken = true
      console.warn(`ADMIN_TOKEN 需为 ${ADMIN_TOKEN_MIN}-${AUTH_TOKEN_MAX} 位且不含空白，当前值已忽略，恢复通道不可用`)
    }
    return ''
  }
  return token
}

function effectiveAuthToken(config, env) {
  return storedAuthToken(config) || authToken(env)
}

/* 首次初始化默认要求先配好 ADMIN_TOKEN。
   未配置的公开实例，第一个打开 /admin 的人就会成为所有者 —— 在扫描器遍地的
   环境里这不是「便捷」，而是「抢注」。因此默认 fail-closed：
   没有恢复令牌就拒绝 /api/setup，并明确告诉部署者该配什么。
   确实需要零配置体验（本地开发、一次性实例）可以显式打开 ALLOW_OPEN_SETUP。 */
function openSetupAllowed(env) {
  const raw = env && env.ALLOW_OPEN_SETUP
  if (typeof raw !== 'string') return false
  const value = raw.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

function bearerToken(request) {
  const header = request.headers.get('authorization') || ''
  if (/^bearer\s/i.test(header)) return header.slice(7).trim()
  return request.headers.get('x-admin-token') || ''
}

/* 订阅令牌优先取查询参数（客户端兼容），其次接受 Authorization: Bearer。
   走头部时令牌不会进入 URL，也就不会被 CDN / Worker 日志与浏览器历史留存。 */
function subscriptionToken(request, url) {
  const query = url.searchParams.get('token') || ''
  if (query) return query
  const header = request.headers.get('authorization') || ''
  if (/^bearer\s/i.test(header)) return header.slice(7).trim()
  return ''
}

function tokenEqual(a, b) {
  if (!a || !b) return false
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  const len = Math.max(x.length, y.length)
  for (let i = 0; i < len; i++) diff |= (x[i] || 0) ^ (y[i] || 0)
  return diff === 0
}

function bytesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

function randomBytes(length) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

function bytesToBase64Url(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(value) {
  const base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function validateUsername(value) {
  if (typeof value !== 'string') throw new HttpError(400, '用户名格式不正确', 'username')
  const username = value.trim()
  if (!USERNAME_RE.test(username)) {
    throw new HttpError(400, '用户名需为 3–254 位（字母、数字或 . _ + @ -），也可以直接填写邮箱地址', 'username')
  }
  // 用户名会显示在账号列表里，零宽 / 双向控制符可以把它伪装成另一个账号
  if (FORMAT_CHARS_RE.test(username)) throw new HttpError(400, '用户名不能包含不可见控制字符', 'username')
  return username
}

/* 只挡「必然被秒破」的口令，不强制字符类别：
   12 位以上的长口令短语（全小写或全字母）本来就更安全，不该被规则逼成 Passw0rd! 这类模式。 */
const WEAK_PASSWORDS = new Set([
  'password1234', 'password12345', 'password123456', 'passw0rd1234',
  '123456789012', '1234567890123', '12345678901234', '111111111111',
  'qwertyuiop12', 'qwertyuiop123', 'qwerty123456', 'asdfghjkl123',
  'administrator', 'administrator1', 'letmein12345', 'iloveyou12345',
  'welcome12345', 'changeme1234', 'admin1234567', 'abc123456789',
])
const KEYBOARD_RUNS = ['0123456789', '9876543210', 'abcdefghijklmnopqrstuvwxyz', 'zyxwvutsrqponmlkjihgfedcba', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']

function weakPasswordReason(password, username) {
  const lower = password.toLowerCase()
  if (WEAK_PASSWORDS.has(lower)) return '该密码在常见弱口令列表中，请换一个'
  // 单一 / 双字符重复：aaaaaaaaaaaa、abababababab
  if (new Set(lower).size <= 2) return '密码字符过于单一，请混合更多不同字符'
  // 去掉分隔符后整体落在键盘序列 / 数字序列里
  const compact = lower.replace(/[\s._-]/g, '')
  if (compact && KEYBOARD_RUNS.some(run => run.includes(compact))) {
    return '密码是连续序列（如 123456789 / qwerty），请换一个'
  }
  const name = String(username || '').toLowerCase().split('@')[0]
  if (name.length >= 3 && lower === name) return '密码不能与用户名相同'
  return ''
}

function validatePassword(value, username) {
  if (typeof value !== 'string' || !value) throw new HttpError(400, '密码不能为空', 'password')
  if (value.length < PASSWORD_MIN) throw new HttpError(400, `密码至少需要 ${PASSWORD_MIN} 个字符`, 'password')
  if (value.length > PASSWORD_MAX) throw new HttpError(400, `密码不能超过 ${PASSWORD_MAX} 个字符`, 'password')
  if (!value.trim()) throw new HttpError(400, '密码不能全部为空格', 'password')
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new HttpError(400, '密码不能包含控制字符', 'password')
  const reason = weakPasswordReason(value, username)
  if (reason) throw new HttpError(400, reason, 'password')
  return value
}

async function derivePasswordHash(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  )
  return new Uint8Array(bits)
}

/* 新建 / 改密时的迭代次数：默认 1 万次以适配免费计划，付费计划可通过环境变量提高。
   已有账号按其存储值校验，改环境变量不会让旧口令失效。 */
let warnedPasswordIterations = false
function passwordIterations(env) {
  const raw = Number(env && env.PASSWORD_ITERATIONS)
  if (!Number.isInteger(raw) || raw < PASSWORD_ITERATIONS) {
    // 1 万次只有 OWASP 建议值的 1/60：免费计划的 10ms CPU 是硬上限，
    // 这里不能擅自调高，但必须让部署者知道自己在什么水位上
    if (!warnedPasswordIterations) {
      warnedPasswordIterations = true
      console.warn(`未配置 PASSWORD_ITERATIONS，按 ${PASSWORD_ITERATIONS} 次迭代派生口令（免费计划 CPU 限制）。付费计划请设为 ${PASSWORD_ITERATIONS_MAX}，否则 KV 一旦泄漏，离线爆破成本很低`)
    }
    return PASSWORD_ITERATIONS
  }
  return Math.min(raw, PASSWORD_ITERATIONS_MAX)
}

async function buildPasswordRecord(password, iterations = PASSWORD_ITERATIONS) {
  const rounds = Math.min(Math.max(iterations, PASSWORD_ITERATIONS), PASSWORD_ITERATIONS_MAX)
  const salt = randomBytes(16)
  const hash = await derivePasswordHash(password, salt, rounds)
  return {
    passwordSalt: bytesToBase64Url(salt),
    passwordHash: bytesToBase64Url(hash),
    passwordIterations: rounds,
  }
}

async function verifyPassword(password, user) {
  if (!user || typeof user.passwordSalt !== 'string' || typeof user.passwordHash !== 'string') return false
  const iterations = Number.isFinite(user.passwordIterations) &&
    user.passwordIterations >= 1000 &&
    user.passwordIterations <= PASSWORD_ITERATIONS_MAX
    ? user.passwordIterations
    : PASSWORD_ITERATIONS
  // 盐/哈希可能因 KV 被手工写坏而不是合法 base64：解码失败按密码不正确处理，不能 500
  let salt
  let expected
  try {
    salt = base64UrlToBytes(user.passwordSalt)
    expected = base64UrlToBytes(user.passwordHash)
  } catch (err) {
    return false
  }
  if (salt.length < 8 || expected.length !== 32) return false
  const actual = await derivePasswordHash(password, salt, iterations)
  return bytesEqual(actual, expected)
}

/* 未知账号也要消耗同等量级的 CPU，否则响应时间会泄漏用户名是否存在 */
async function dummyPasswordCheck(password, iterations = PASSWORD_ITERATIONS) {
  const rounds = Math.min(Math.max(iterations, PASSWORD_ITERATIONS), PASSWORD_ITERATIONS_MAX)
  await derivePasswordHash(
    String(password || '').slice(0, PASSWORD_MAX),
    randomBytes(16),
    rounds
  )
  return false
}

/* KV 里的 secret 是 base64url；环境变量 SESSION_SECRET 是普通字符串，
   两者不能走同一个 importKey（atob 会拒绝非 base64 字符）。 */
async function hmacSign(secret, value) {
  return await hmacSignBytes(base64UrlToBytes(secret), value)
}

async function hmacSignText(textSecret, value) {
  return await hmacSignBytes(new TextEncoder().encode(textSecret), value)
}

async function hmacSignBytes(keyBytes, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return new Uint8Array(signature)
}

/* 会话签名密钥：优先用环境变量 SESSION_SECRET，这样即使 KV 被读走也无法伪造会话
   （KV 里的 secret 只用于派生成员订阅令牌）。未配置时回落到 KV 内的随机 secret，
   保持零配置可用；配置了但不合格则告警并回落，不会让控制台直接不可用。 */
let warnedWeakSessionSecret = false
function sessionKey(store, env) {
  const raw = env && env.SESSION_SECRET
  if (typeof raw === 'string') {
    const value = raw.trim()
    if (value.length >= 32 && value.length <= 256 && !/[\s\u0000-\u001f\u007f]/.test(value)) {
      return { kind: 'env', value }
    }
    if (value && !warnedWeakSessionSecret) {
      warnedWeakSessionSecret = true
      console.warn('SESSION_SECRET 需为 32-256 位且不含空白，当前值已忽略，回落到 KV 内的会话密钥')
    }
  }
  return { kind: 'kv', value: store.secret }
}

async function signSession(key, value) {
  return key.kind === 'env' ? await hmacSignText(key.value, value) : await hmacSign(key.value, value)
}

function sessionTtlSeconds(env) {
  const raw = Number(env && env.SESSION_TTL_HOURS)
  if (!Number.isFinite(raw) || raw < SESSION_TTL_HOURS_MIN) return SESSION_TTL_HOURS_DEFAULT * 3600
  return Math.round(Math.min(raw, SESSION_TTL_HOURS_MAX) * 3600)
}

async function createSessionToken(user, key, env) {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    v: 1,
    sub: user.id,
    ver: user.version,
    iat: now,
    exp: now + sessionTtlSeconds(env),
  }
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const signature = await signSession(key, body)
  return `${body}.${bytesToBase64Url(signature)}`
}

async function verifySessionToken(token, key) {
  if (typeof token !== 'string' || token.length > SESSION_TOKEN_MAX) return null
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  let supplied
  try {
    supplied = base64UrlToBytes(parts[1])
  } catch (err) {
    return null
  }
  // 先验签再解析：不能让未签名的 payload 影响任何分支
  const expected = await signSession(key, parts[0])
  if (!bytesEqual(supplied, expected)) return null

  let payload
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])))
  } catch (err) {
    return null
  }
  if (!payload || payload.v !== 1) return null
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 80) return null
  if (!Number.isInteger(payload.ver) || payload.ver < 1) return null
  if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) return null
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp <= now) return null
  // 未来时间戳 = 时钟回拨或伪造：留 60 秒容差
  if (payload.iat > now + 60) return null
  // 有效期上限兜底：签名密钥泄漏后攻击者也无法签出「十年不过期」的会话
  if (payload.exp - payload.iat > SESSION_TTL_MAX) return null
  return payload
}

function newUserId() {
  return 'u_' + (crypto.randomUUID ? crypto.randomUUID() : bytesToBase64Url(randomBytes(16)))
}

/* 盐/哈希必须是可解码的 base64url，否则 verifyPassword 会抛未捕获异常导致登录 500 */
function isDecodableBase64Url(value) {
  if (typeof value !== 'string' || !value) return false
  try {
    base64UrlToBytes(value)
    return true
  } catch (err) {
    return false
  }
}

const ROLES = ['owner', 'member']

/* 节点范围只存节点 id：名称 / 服务器会变，id 才是稳定标识。
   读取 KV 时也走这里，因此对旧数据必须是宽松的（丢弃无法识别的项，而不是抛错）。 */
function sanitizeScope(input) {
  const out = { allNodes: false, nodeIds: [] }
  if (!input || typeof input !== 'object') return out
  out.allNodes = input.allNodes === true
  if (!Array.isArray(input.nodeIds)) return out
  const seen = new Set()
  for (const item of input.nodeIds) {
    if (typeof item !== 'string') continue
    const id = item.slice(0, 64)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.nodeIds.push(id)
    if (out.nodeIds.length >= MAX_NODES) break
  }
  return out
}

function validateScope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, '节点可用范围格式不正确', 'scope')
  }
  if (input.allNodes !== undefined && typeof input.allNodes !== 'boolean') {
    throw new HttpError(400, '节点可用范围格式不正确', 'scope')
  }
  if (input.nodeIds !== undefined && !Array.isArray(input.nodeIds)) {
    throw new HttpError(400, '节点可用范围格式不正确', 'scope')
  }
  return sanitizeScope(input)
}

function normalizeStoredUser(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('invalid user')
  // id 会拼进 KV 键（user_nodes:<id>）与订阅令牌：只允许安全字符并限长，
  // 避免手工写坏的 KV 记录产生超长键或带分隔符的键
  if (typeof raw.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(raw.id)) throw new Error('invalid user id')
  if (typeof raw.username !== 'string' || !USERNAME_RE.test(raw.username)) throw new Error('invalid username')
  if (typeof raw.passwordSalt !== 'string' || typeof raw.passwordHash !== 'string') throw new Error('invalid password')
  if (!isDecodableBase64Url(raw.passwordSalt) || !isDecodableBase64Url(raw.passwordHash)) {
    throw new Error('invalid password encoding')
  }
  if (!Number.isFinite(raw.passwordIterations)) throw new Error('invalid password iterations')
  // 与 verifyPassword 使用同一区间，避免读路径和校验路径对同一条记录得出不同结论
  const iterations = raw.passwordIterations >= 1000 && raw.passwordIterations <= PASSWORD_ITERATIONS_MAX
    ? raw.passwordIterations
    : PASSWORD_ITERATIONS
  const version = Number.isFinite(raw.version) && raw.version > 0 ? raw.version : 1
  return {
    id: raw.id,
    username: raw.username,
    usernameKey: raw.username.toLowerCase(),
    passwordSalt: raw.passwordSalt,
    passwordHash: raw.passwordHash,
    passwordIterations: iterations,
    version,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    role: ROLES.includes(raw.role) ? raw.role : '',
    scope: raw.scope === undefined ? null : sanitizeScope(raw.scope),
  }
}

/* 升级迁移：旧记录没有 role，按「首个账号为所有者，其余为成员」处理。
   旧成员保留全部节点（升级不能突然掐断已有订阅），新成员由所有者显式分配。
   迁移只在内存中完成，下一次所有者写账号时自然落盘，读路径不产生 KV 写入。 */
function migrateUserRoles(users) {
  const hasOwner = users.some(user => user.role === 'owner')
  return users.map((user, index) => {
    const legacy = !user.role
    let role = legacy ? 'member' : user.role
    if (legacy && !hasOwner && index === 0) role = 'owner'
    let scope
    if (role === 'owner') scope = { allNodes: true, nodeIds: [] }
    else if (user.scope) scope = user.scope
    else scope = { allNodes: legacy, nodeIds: [] }
    return { ...user, role, scope }
  })
}

async function readUsersStore(env) {
  const kv = kvBinding(env)
  if (!kv) return { store: null, readonly: true, corrupted: false }

  let raw
  try {
    raw = await kv.get(USERS_KEY)
  } catch (err) {
    console.error('Users KV read failed:', err)
    throw new HttpError(502, '读取用户数据失败，请检查 KV 绑定')
  }
  if (!raw) return { store: null, readonly: false, corrupted: false }

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.users) || !parsed.users.length) throw new Error('empty users')
    if (typeof parsed.secret !== 'string' || base64UrlToBytes(parsed.secret).length < 16) {
      throw new Error('invalid session secret')
    }
    const users = migrateUserRoles(parsed.users.map(normalizeStoredUser))
    return {
      store: {
        v: 1,
        rev: Number.isFinite(parsed.rev) ? parsed.rev : 1,
        secret: parsed.secret,
        users,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      },
      readonly: false,
      corrupted: false,
    }
  } catch (err) {
    console.error('Users store corrupted:', err)
    return { store: null, readonly: false, corrupted: true }
  }
}

async function writeUsersStore(env, store) {
  const kv = kvBinding(env)
  if (!kv) throw new HttpError(503, '尚未绑定 KV 存储，无法保存用户')
  try {
    await kv.put(USERS_KEY, JSON.stringify(store))
  } catch (err) {
    console.error('Users KV write failed:', err)
    throw new HttpError(502, '写入用户数据失败，请稍后重试')
  }
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt,
    role: user.role,
    scope: { allNodes: user.scope.allNodes, nodeIds: user.scope.nodeIds.slice() },
  }
}

/* 账号接口共用：区分「没绑 KV」「还没初始化」「数据损坏」三种状态，
   损坏时不能像未初始化那样提示用户去创建账号，否则会误导成可以覆盖原数据 */
function usersStoreError(result) {
  if (result.store) return null
  if (result.corrupted) {
    return json({ error: '用户数据已损坏，请在 Cloudflare KV 中修复或删除 users 记录后再操作', corrupted: true }, 409)
  }
  if (result.readonly) {
    return json({ error: '尚未绑定 KV 存储，无法管理账号' }, 503)
  }
  return json({ error: '控制台尚未初始化' }, 409)
}

function usersResponse(store, principal) {
  return {
    users: store.users.map(publicUser),
    rev: store.rev,
    currentUserId: principal && principal.userId ? principal.userId : null,
    maxUsers: MAX_USERS,
  }
}

/* 恢复令牌爆破计数用的虚拟用户名（与登录限流共用桶，但独立计数） */
const RECOVERY_RATE_KEY = '__recovery__'

/* 会话令牌形如 base64url.base64url；恢复令牌与订阅令牌都没有点 */
function looksLikeSessionToken(value) {
  const parts = String(value || '').split('.')
  return parts.length === 2 &&
    /^[A-Za-z0-9_-]+$/.test(parts[0]) &&
    /^[A-Za-z0-9_-]+$/.test(parts[1])
}

/* 每个成员一条独立订阅链接：令牌由账号 id + 版本派生，改密（version+1）即失效。
   服务端不需要额外存储，也无法从令牌反推出其他账号的链接。 */
async function deriveSubscriptionToken(user, secret) {
  const signature = await hmacSign(secret, `sub|${user.id}|${user.version}`)
  const idPart = bytesToBase64Url(new TextEncoder().encode(user.id))
  return 'sub_' + idPart + '.' + bytesToBase64Url(signature)
}

function isOwner(principal) {
  return !!principal && principal.role === 'owner'
}

function requireOwner(principal, message) {
  if (!isOwner(principal)) throw new HttpError(403, message || '只有所有者可以执行此操作')
}

/* 成员的控制台与订阅都只包含其可用节点；所有者（及全局订阅令牌）不受限制。
   defaults 里放的是所有者自己的预设凭据（VLESS UUID / Reality 公钥 / 回落域名），
   成员拿着没有任何正当用途，却等于白送一份可用凭据，因此对成员一律清空。
   regionOrder 也按过滤后的节点集重建，避免把 scope 之外节点的 id 一起下发。 */
function filterConfigForPrincipal(config, principal) {
  if (!principal || isOwner(principal)) return config
  const scope = principal.scope || { allNodes: false, nodeIds: [] }
  let nodes = config.nodes
  if (!scope.allNodes) {
    const allowed = new Set(scope.nodeIds)
    nodes = config.nodes.filter(node => allowed.has(node.id))
  }
  return {
    ...config,
    nodes,
    defaults: {},
    regionOrder: reconcileRegionOrder(config.regionOrder, nodes),
  }
}

async function authenticateRequest(request, env) {
  const supplied = bearerToken(request)
  if (!supplied) return null

  const dedicated = dedicatedAdminToken(env)
  if (dedicated) {
    if (tokenEqual(supplied, dedicated)) {
      clearLoginFailures(request, RECOVERY_RATE_KEY)
      return {
        kind: 'recovery',
        username: '部署恢复令牌',
        userId: null,
        user: null,
        role: 'owner',
        scope: { allNodes: true, nodeIds: [] },
      }
    }
    // 既不是恢复令牌、也不像会话令牌：按恢复通道爆破处理（8 次 / 10 分钟）
    if (!looksLikeSessionToken(supplied)) {
      const limited = checkLoginRateLimit(request, RECOVERY_RATE_KEY)
      if (limited) throw new HttpError(429, '尝试次数过多，请稍后再试')
      recordLoginFailure(request, RECOVERY_RATE_KEY)
    }
  }

  /* 形态不符的 Bearer（随手一串字符）在读 KV 之前就否掉：
     否则每个未鉴权请求都会换来一次 KV 读 + 一次 HMAC，等于把
     「不需要凭据」的路径变成可放大的 IO 成本。 */
  if (supplied.length > SESSION_TOKEN_MAX || !looksLikeSessionToken(supplied)) return null

  const { store } = await readUsersStore(env)
  if (!store) return null
  const payload = await verifySessionToken(supplied, sessionKey(store, env))
  if (!payload) return null
  const user = store.users.find(item => item.id === payload.sub)
  if (!user || Number(payload.ver) !== user.version) return null
  return {
    kind: 'session',
    username: user.username,
    userId: user.id,
    user,
    role: user.role,
    scope: user.scope,
    subscriptionToken: user.role === 'member'
      ? await deriveSubscriptionToken(user, store.secret)
      : null,
  }
}

/* 成员订阅令牌：sub_<base64url(userId)>.<签名>。
   带上 userId 后校验只需一次 HMAC + 一次查表，不再「遍历全部账号逐个比对」——
   未鉴权请求无法用合法前缀放大 CPU，也不再有「哪个账号匹配」的时序信号。
   不带 userId 的旧格式（sub_<签名>）仍然接受，改密后自然轮换到新格式。 */
async function matchSubscriptionToken(token, store) {
  const body = token.slice('sub_'.length)
  const dot = body.indexOf('.')
  if (dot > 0) {
    let userId
    try {
      userId = new TextDecoder().decode(base64UrlToBytes(body.slice(0, dot)))
    } catch (err) {
      return null
    }
    const user = store.users.find(item => item.id === userId)
    if (!user) return null
    const candidate = await deriveSubscriptionToken(user, store.secret)
    return tokenEqual(token, candidate) ? user : null
  }
  // 旧格式：逐账号比较且不提前退出，保持原有的时序特征
  let matched = null
  for (const user of store.users) {
    const candidate = await deriveSubscriptionToken(user, store.secret)
    if (tokenEqual(token, candidate)) matched = user
  }
  return matched
}

async function subscriptionAccess(env, token) {
  // 长度先兜底：超长令牌必然无效，没必要为它读一次 KV（未鉴权请求的可控成本）
  if (typeof token !== 'string' || !token || token.length > AUTH_TOKEN_MAX) return null
  const config = (await readConfig(env)).config
  const expected = effectiveAuthToken(config, env)
  if (expected && tokenEqual(token, expected)) return { config }
  if (!token.startsWith('sub_')) return null

  const { store } = await readUsersStore(env)
  if (!store) return null
  const matched = await matchSubscriptionToken(token, store)
  if (!matched) return null
  const base = filterConfigForPrincipal(config, { role: matched.role, scope: matched.scope })
  if (matched.role === 'owner') return { config: base }
  const personal = await readPersonalNodes(env, matched.id)
  return {
    config: personal.nodes.length
      ? { ...base, nodes: mergePersonalNodes(base.nodes, personal.nodes) }
      : base,
  }
}

/* ------------------------------------------------------------------ */
/* storage                                                             */
/* ------------------------------------------------------------------ */

function kvBinding(env) {
  const kv = env && env.SUB_KV
  return kv && typeof kv.get === 'function' && typeof kv.put === 'function' ? kv : null
}

function emptyConfig() {
  return { v: 1, rev: 0, updatedAt: null, nodes: [], defaults: {}, regionOrder: {}, subscription: {}, authToken: '', providerBase: '' }
}

const PROVIDER_BASE_DEFAULT = 'https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release'

/* rule-providers 的镜像前缀：允许换成自建 / 国内可达的 CDN，空值用默认。
   只接受 https:// 开头、无空白与控制字符、无引号与反斜杠的短 URL，避免拼进 YAML 后破坏结构。
   `#` 会把该行后面的 `path:` / `interval:` 注释掉，`?` 之后的内容也不会参与取文件，
   两者都只会产出坏配置，直接拒掉。 */
function sanitizeProviderBase(input) {
  const value = typeof input === 'string' ? input.trim() : ''
  if (!value) return ''
  if (value.length > 256) return ''
  if (/[\s\u0000-\u001f\u007f"'\\#?]/.test(value)) return ''
  if (!/^https:\/\/[A-Za-z0-9._~:/@!$&*+,;=%-]+$/.test(value)) return ''
  return value.replace(/\/+$/, '')
}

function validateProviderBase(value) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw new HttpError(400, 'rule-providers 镜像地址格式不正确', 'providerBase')
  const cleaned = sanitizeProviderBase(value)
  if (!cleaned) {
    throw new HttpError(400, 'rule-providers 镜像地址需为 https:// 开头、不含空格与引号且不超过 256 个字符', 'providerBase')
  }
  return cleaned
}

function sanitizeDefaults(input) {
  const out = {}
  if (!input || typeof input !== 'object') return out
  const text = value => (typeof value === 'string' ? value.trim() : '')
  if (text(input.vlessUuid)) out.vlessUuid = text(input.vlessUuid)
  if (text(input.vlessPublicKey)) out.vlessPublicKey = text(input.vlessPublicKey)
  if (text(input.vlessShortId)) out.vlessShortId = text(input.vlessShortId)
  if (text(input.vlessServername)) {
    // 读路径也要拦：旧数据 / 手工改过的 KV 不能把含空白、引号或不可见字符的
    // SNI 原样回填进表单，否则等于绕过写路径的 hostValue 校验
    const sni = text(input.vlessServername)
    if (/^[A-Za-z0-9._%:\-\[\]]+$/.test(sni) && !FORMAT_CHARS_RE.test(sni)) out.vlessServername = sni
  }
  const port = Number(input.vlessPort)
  if (Number.isInteger(port) && port >= 1 && port <= 65535) out.vlessPort = port
  return out
}

const MAX_TOTAL_GB = 1048576
const AUTH_TOKEN_MIN = 16
const AUTH_TOKEN_MAX = 256
const ADMIN_TOKEN_MIN = 16

/* 会话有效期：默认 7 天，可用 SESSION_TTL_HOURS 缩短（1-168 小时）。
   verifySessionToken 始终按 SESSION_TTL_MAX 兜底，因此调小配置不会让已签发的
   旧令牌「超长有效」——它们仍然会在自己的 exp 到期后失效。 */
const SESSION_TTL_HOURS_DEFAULT = 168
const SESSION_TTL_HOURS_MIN = 1
const SESSION_TTL_HOURS_MAX = 168
const SESSION_TTL_MAX = SESSION_TTL_HOURS_MAX * 60 * 60

/* 会话令牌的形态上限：payload + 签名远小于这个值，超出必然是垃圾输入 */
const SESSION_TOKEN_MAX = 512

/* 双向控制符 / 零宽字符：会让「节点名」「用户名」在界面上显示成另一串字符
   （例如用 RLO 把 evil.com 伪装成 moc.live），除了欺骗审核者没有正当用途 */
const FORMAT_CHARS_RE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/

let warnedStoredAuthToken = false

function storedAuthToken(config) {
  const value = config && config.authToken
  if (typeof value !== 'string') return ''
  const token = value.trim()
  if (!token) return ''
  // 写路径有 16 位下限，读路径也必须一致：否则 KV 被改坏（或被旧版本写短）
  // 之后，一个几位的令牌就能拉走整份订阅
  if (token.length < AUTH_TOKEN_MIN || token.length > AUTH_TOKEN_MAX || /[\s\u0000-\u001f\u007f]/.test(token)) {
    if (!warnedStoredAuthToken) {
      warnedStoredAuthToken = true
      console.warn(`KV 中的订阅令牌不符合 ${AUTH_TOKEN_MIN}-${AUTH_TOKEN_MAX} 位且不含空白的规则，已忽略；请在设置页重新生成`)
    }
    return ''
  }
  return token
}

function validateAuthToken(value) {
  if (typeof value !== 'string') throw new HttpError(400, '订阅令牌格式不正确', 'authToken')
  const token = value.trim()
  if (!token) return ''
  // 掩码字符不可能是合法令牌：避免前端把「••••abcd」原样回传，把订阅链接改掉
  // 放在长度校验之前，无论掩码多长都能给出可执行的提示
  if (token.includes('•')) {
    throw new HttpError(400, '订阅令牌不能包含掩码字符，请填写完整令牌', 'authToken')
  }
  if (token.length < AUTH_TOKEN_MIN) {
    throw new HttpError(400, `订阅令牌至少需要 ${AUTH_TOKEN_MIN} 个字符`, 'authToken')
  }
  if (token.length > AUTH_TOKEN_MAX) {
    throw new HttpError(400, `订阅令牌不能超过 ${AUTH_TOKEN_MAX} 个字符`, 'authToken')
  }
  if (/[\s\u0000-\u001f\u007f]/.test(token)) {
    throw new HttpError(400, '订阅令牌不能包含空格或控制字符', 'authToken')
  }
  return token
}

// 订阅信息只用于客户端展示（流量条 / 到期提示），留空则不发送相应响应头
function sanitizeSubscription(input) {
  const out = {}
  if (!input || typeof input !== 'object') return out
  const total = Number(input.totalGB)
  if (Number.isFinite(total) && total > 0) {
    out.totalGB = Math.min(Math.round(total * 100) / 100, MAX_TOTAL_GB)
  }
  if (typeof input.expire === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.expire)) {
    const time = Date.parse(`${input.expire}T23:59:59Z`)
    // 上限 2100 年：避免手滑写成 9999 后客户端把「到期」显示成永不过期
    if (Number.isFinite(time) && time <= Date.UTC(2100, 11, 31)) out.expire = input.expire
  }
  return out
}

async function readConfig(env, options = {}) {
  const kv = kvBinding(env)
  if (!kv) {
    return { config: emptyConfig(), readonly: true, corrupted: false }
  }

  let raw
  try {
    raw = await kv.get(CONFIG_KEY)
  } catch (err) {
    console.error('KV read failed:', err)
    throw new HttpError(502, '读取 KV 失败，请检查 SUB_KV 绑定是否正常')
  }

  if (!raw) {
    const seeded = emptyConfig()
    // 只有写路径才落盘：订阅与伪装页这类未鉴权的读请求不应该产生 KV 写入
    if (options.seed) {
      try {
        await kv.put(CONFIG_KEY, JSON.stringify(seeded))
      } catch (err) {
        console.error('KV seed failed:', err)
        throw new HttpError(502, '初始化 KV 失败，请检查 SUB_KV 绑定是否正常')
      }
    }
    return { config: seeded, readonly: false, corrupted: false }
  }

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.nodes)) throw new Error('invalid config shape')
    /* 元素级兜底：旧版本写入、手工编辑或并发写入都可能留下 null / 非对象元素，
       只判断「是不是数组」不够——buildYaml 里一句 node.enabled 就会让整条订阅 500。
       坏元素直接丢弃，渲染层（isRenderableNode）再兜一层字段级校验。 */
    const nodes = parsed.nodes.filter(node => node && typeof node === 'object' && !Array.isArray(node))
    return {
      config: {
        v: 1,
        rev: Number.isFinite(parsed.rev) ? parsed.rev : 1,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
        nodes,
        defaults: sanitizeDefaults(parsed.defaults),
        regionOrder: reconcileRegionOrder(parsed.regionOrder, nodes),
        subscription: sanitizeSubscription(parsed.subscription),
        authToken: storedAuthToken(parsed),
        providerBase: sanitizeProviderBase(parsed.providerBase),
      },
      readonly: false,
      corrupted: false,
    }
  } catch (err) {
    console.error('Config corrupted:', err)
    return { config: emptyConfig(), readonly: false, corrupted: true }
  }
}

async function writeConfig(env, config) {
  const kv = kvBinding(env)
  if (!kv) throw new HttpError(503, '尚未绑定 KV 存储，无法保存')
  try {
    await kv.put(CONFIG_KEY, JSON.stringify(config))
  } catch (err) {
    console.error('KV write failed:', err)
    throw new HttpError(502, '写入 KV 失败，请稍后重试')
  }
}

function personalNodesKey(userId) {
  return PERSONAL_KEY_PREFIX + userId
}

/* 读路径同样不信任 KV：逐条过一遍写入校验，坏数据只丢该条，
   不会让某个成员的个人节点把整份订阅拖成 500。 */
function normalizePersonalNodes(input) {
  if (!Array.isArray(input)) return []
  const ids = new Set()
  const names = new Set()
  const out = []
  for (const raw of input.slice(0, MAX_PERSONAL_NODES)) {
    if (!raw || typeof raw !== 'object') continue
    if (typeof raw.id !== 'string' || !PERSONAL_ID_RE.test(raw.id) || ids.has(raw.id)) continue
    const nameKey = typeof raw.name === 'string' ? raw.name.trim().toLowerCase() : ''
    if (!nameKey || names.has(nameKey)) continue
    let node
    try {
      node = validateNodes([{ ...raw, id: raw.id }])[0]
    } catch (err) {
      continue
    }
    ids.add(node.id)
    names.add(nameKey)
    out.push(node)
  }
  return out
}

async function readPersonalNodes(env, userId) {
  const empty = { nodes: [], rev: 0, corrupted: false }
  if (!userId) return empty
  const kv = kvBinding(env)
  if (!kv) return empty

  let raw
  try {
    raw = await kv.get(personalNodesKey(userId))
  } catch (err) {
    console.error('Personal nodes read failed:', err)
    return { ...empty, corrupted: true }
  }
  if (!raw) return empty

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.nodes)) throw new Error('invalid personal node store')
    return {
      nodes: normalizePersonalNodes(parsed.nodes),
      rev: Number.isFinite(parsed.rev) ? parsed.rev : 1,
      corrupted: false,
    }
  } catch (err) {
    console.error('Personal nodes corrupted:', err)
    return { ...empty, corrupted: true }
  }
}

async function writePersonalNodes(env, userId, store) {
  const kv = kvBinding(env)
  if (!kv) throw new HttpError(503, '尚未绑定 KV 存储，无法保存')
  try {
    await kv.put(personalNodesKey(userId), JSON.stringify(store))
  } catch (err) {
    console.error('Personal nodes write failed:', err)
    throw new HttpError(502, '写入 KV 失败，请稍后重试')
  }
}

async function deletePersonalNodes(env, userId) {
  const kv = kvBinding(env)
  if (!kv || !userId || typeof kv.delete !== 'function') return
  try {
    await kv.delete(personalNodesKey(userId))
  } catch (err) {
    // 账号已经删掉，残留键不可再被任何会话读取；清理失败只记日志
    console.warn('Personal nodes cleanup failed:', err)
  }
}

/* 个人节点追加在管理员节点之后；名称冲突时加后缀而不是覆盖，
   因为管理员可能事后新增了同名节点，这时不能让某个成员的订阅因重名而失效。 */
function mergePersonalNodes(baseNodes, personalNodes) {
  if (!personalNodes.length) return baseNodes
  const ids = new Set(baseNodes.map(node => node.id))
  const names = new Set(baseNodes.map(node => node.name.toLowerCase()))
  const merged = []
  for (const node of personalNodes) {
    let id = node.id
    while (ids.has(id)) id = 'p_' + crypto.randomUUID()
    let name = node.name
    if (names.has(name.toLowerCase())) {
      const root = `${node.name} · 个人`.slice(0, 80)
      name = root
      let index = 2
      while (names.has(name.toLowerCase())) {
        const suffix = ` (${index})`
        name = root.slice(0, 80 - suffix.length) + suffix
        index += 1
      }
    }
    ids.add(id)
    names.add(name.toLowerCase())
    merged.push(id === node.id && name === node.name ? node : { ...node, id, name })
  }
  return baseNodes.concat(merged)
}

/* 成员的可用节点 = 管理员分配的节点 + 自己的个人节点。
   所有读路径（配置、预览、订阅）都走这里，避免三处行为漂移。 */
async function configForPrincipal(env, config, principal) {
  const filtered = filterConfigForPrincipal(config, principal)
  if (!principal || isOwner(principal) || !principal.userId) return { config: filtered, personal: null }
  const personal = await readPersonalNodes(env, principal.userId)
  if (!personal.nodes.length) return { config: filtered, personal }
  return {
    config: { ...filtered, nodes: mergePersonalNodes(filtered.nodes, personal.nodes) },
    personal,
  }
}

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */

function requireString(value, field, label, max) {
  if (typeof value !== 'string') throw new HttpError(400, `${label}不能为空`, field)
  const text = value.trim()
  if (!text) throw new HttpError(400, `${label}不能为空`, field)
  if (text.length > max) throw new HttpError(400, `${label}不能超过 ${max} 个字符`, field)
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new HttpError(400, `${label}包含非法字符`, field)
  return text
}

function optionalString(value, field, label, max) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw new HttpError(400, `${label}格式不正确`, field)
  const text = value.trim()
  if (!text) return ''
  if (text.length > max) throw new HttpError(400, `${label}不能超过 ${max} 个字符`, field)
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new HttpError(400, `${label}包含非法字符`, field)
  return text
}

function hostValue(value, field, label, { required = false } = {}) {
  const text = required
    ? requireString(value, field, label, 253)
    : optionalString(value, field, label, 253)
  if (!text) return ''
  if (!/^[A-Za-z0-9._%:\-\[\]]+$/.test(text)) {
    throw new HttpError(400, `${label}只能包含域名、IPv4 或 IPv6 地址`, field)
  }
  if (FORMAT_CHARS_RE.test(text)) throw new HttpError(400, `${label}包含不可见控制字符`, field)
  return text
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null) return fallback
  return value === true
}

function portValue(value) {
  const port = typeof value === 'string' ? Number(value.trim()) : value
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new HttpError(400, '端口必须是 1 - 65535 之间的整数', 'port')
  }
  return port
}

function bandwidthValue(value, field, label) {
  const text = optionalString(value, field, label, 24)
  if (!text) return ''
  const match = text.match(/^(\d{1,6}(?:\.\d{1,2})?)\s*(kbps|mbps|gbps)$/i)
  if (!match) throw new HttpError(400, `${label}格式应为 80 mbps`, field)
  return `${match[1]} ${match[2].toLowerCase()}`
}

const GROUP_REGIONS = ['us', 'jp', 'hk', 'relay']

function sanitizeRegionOrder(input) {
  const out = {}
  if (!input || typeof input !== 'object') return out
  GROUP_REGIONS.forEach(region => {
    const arr = input[region]
    if (!Array.isArray(arr)) return
    const seen = new Set()
    const clean = []
    arr.forEach(id => {
      if (typeof id === 'string' && id && !seen.has(id)) {
        seen.add(id)
        clean.push(id)
      }
    })
    if (clean.length) out[region] = clean
  })
  return out
}

// 按当前节点名单整理分组顺序：剔除已删除/已换组 id，未收录的本组节点按全局顺序追加到末尾
function reconcileRegionOrder(stored, nodes) {
  const clean = sanitizeRegionOrder(stored)
  const byRegion = { us: [], jp: [], hk: [], relay: [] }
  nodes.forEach(node => {
    if (node && byRegion[node.region]) byRegion[node.region].push(node.id)
  })
  const out = {}
  GROUP_REGIONS.forEach(region => {
    const members = new Set(byRegion[region])
    const seen = new Set()
    const arr = []
    ;(clean[region] || []).forEach(id => {
      if (members.has(id) && !seen.has(id)) {
        seen.add(id)
        arr.push(id)
      }
    })
    byRegion[region].forEach(id => {
      if (!seen.has(id)) {
        seen.add(id)
        arr.push(id)
      }
    })
    if (arr.length) out[region] = arr
  })
  return out
}

function validateDefaults(input) {
  const cleaned = sanitizeDefaults(input)
  if (cleaned.vlessUuid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleaned.vlessUuid)) {
    throw new HttpError(400, '预设 UUID 格式不正确', 'defaults.vlessUuid')
  }
  if (cleaned.vlessPublicKey && cleaned.vlessPublicKey.length > 128) {
    throw new HttpError(400, '预设 Reality 公钥不能超过 128 个字符', 'defaults.vlessPublicKey')
  }
  if (cleaned.vlessShortId && cleaned.vlessShortId.length > 32) {
    throw new HttpError(400, '预设 Reality Short ID 不能超过 32 个字符', 'defaults.vlessShortId')
  }
  if (cleaned.vlessServername) {
    const sni = hostValue(cleaned.vlessServername, 'defaults.vlessServername', '预设 SNI / 回落域名')
    cleaned.vlessServername = sni
  }
  const rawPort = input && typeof input === 'object' ? input.vlessPort : undefined
  if (rawPort !== undefined && rawPort !== null && rawPort !== '' && cleaned.vlessPort === undefined) {
    throw new HttpError(400, '预设端口需为 1–65535 的整数', 'defaults.vlessPort')
  }
  return cleaned
}

function validateNodes(input) {
  if (!Array.isArray(input)) throw new HttpError(400, '节点数据格式不正确')
  if (input.length > MAX_NODES) throw new HttpError(400, `节点数量不能超过 ${MAX_NODES} 个`)

  const allowedFingerprints = FINGERPRINTS
  const allowedNetworks = NETWORKS
  const allowedCiphers = CIPHERS
  const ids = new Set()
  const names = new Set()
  const nodes = []

  input.forEach((raw, index) => {
    const seq = index + 1
    if (!raw || typeof raw !== 'object') throw new HttpError(400, `第 ${seq} 个节点数据无效`)

    const name = requireString(raw.name, 'name', '节点名称', 80)
    if (FORMAT_CHARS_RE.test(name)) {
      throw new HttpError(400, '节点名称不能包含不可见控制字符', 'name')
    }
    if (RESERVED_NAMES.has(name)) {
      throw new HttpError(400, `节点名称「${name}」与策略组或内置策略冲突`, 'name')
    }
    const nameKey = name.toLowerCase()
    if (names.has(nameKey)) throw new HttpError(400, `节点名称「${name}」重复`, 'name')
    names.add(nameKey)

    const type = TYPES.includes(raw.type) ? raw.type : ''
    if (!type) throw new HttpError(400, `节点「${name}」的协议类型不受支持`, 'type')
    const server = hostValue(raw.server, 'server', '服务器地址', { required: true })
    const port = portValue(raw.port)
    const region = REGIONS.includes(raw.region) ? raw.region : 'other'
    const tags = Array.isArray(raw.tags)
      ? [...new Set(raw.tags.filter(tag => TAGS.includes(tag)))]
      : []
    const enabled = raw.enabled !== false
    const showInMain = raw.showInMain !== false

    let id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) ? raw.id : ''
    if (!id || ids.has(id)) id = 'n_' + crypto.randomUUID()
    ids.add(id)

    const node = { id, name, type, server, port, region, enabled, showInMain, tags }

    if (type === 'vless') {
      const uuid = requireString(raw.uuid, 'uuid', 'UUID', 64)
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
        throw new HttpError(400, `节点「${name}」的 UUID 格式不正确`, 'uuid')
      }
      node.uuid = uuid.toLowerCase()
      const network = allowedNetworks.includes(raw.network) ? raw.network : 'tcp'
      const reality = boolValue(raw.reality)
      if (reality && network !== 'tcp') {
        throw new HttpError(400, `节点「${name}」的 Reality 仅支持 TCP 传输`, 'reality')
      }
      node.network = network
      node.tls = boolValue(raw.tls, true)
      node.reality = reality
      node.servername = hostValue(raw.servername, 'servername', 'SNI / 回落域名')
      if (reality) {
        node.publicKey = requireString(raw.publicKey, 'publicKey', 'Reality 公钥', 128)
        node.shortId = optionalString(raw.shortId, 'shortId', 'Reality Short ID', 32)
      }
      node.flow = ['', 'xtls-rprx-vision'].includes(raw.flow) ? raw.flow || '' : ''
      node.fingerprint = allowedFingerprints.includes(raw.fingerprint) ? raw.fingerprint : 'chrome'
      node.udp = boolValue(raw.udp, true)
      if (network === 'ws') {
        node.wsPath = optionalString(raw.wsPath, 'wsPath', 'WS Path', 256) || '/'
        node.wsHost = hostValue(raw.wsHost, 'wsHost', 'WS Host')
      }
      if (network === 'grpc') {
        node.grpcService = optionalString(raw.grpcService, 'grpcService', 'gRPC 服务名', 64)
      }
    } else if (type === 'vmess') {
      const uuid = requireString(raw.uuid, 'uuid', 'UUID', 64)
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
        throw new HttpError(400, `节点「${name}」的 UUID 格式不正确`, 'uuid')
      }
      node.uuid = uuid.toLowerCase()
      node.network = ['tcp', 'ws', 'grpc'].includes(raw.network) ? raw.network : 'ws'
      node.tls = boolValue(raw.tls)
      node.servername = hostValue(raw.servername, 'servername', 'SNI')
      node.udp = boolValue(raw.udp, true)
      if (node.network === 'ws') {
        node.wsPath = optionalString(raw.wsPath, 'wsPath', 'WS Path', 256) || '/'
        node.wsHost = hostValue(raw.wsHost, 'wsHost', 'WS Host')
      }
      if (node.network === 'grpc') {
        node.grpcService = optionalString(raw.grpcService, 'grpcService', 'gRPC 服务名', 64)
      }
    } else if (type === 'trojan') {
      node.password = requireString(raw.password, 'password', '密码', 128)
      node.sni = hostValue(raw.sni, 'sni', 'SNI')
      // 默认校验证书：跳过校验只应由用户在抽屉里显式打开（自签 / 测试场景）
      node.skipCertVerify = boolValue(raw.skipCertVerify)
      node.udp = boolValue(raw.udp, true)
    } else if (type === 'hysteria2') {
      node.password = requireString(raw.password, 'password', '密码', 128)
      node.sni = hostValue(raw.sni, 'sni', 'SNI')
      node.skipCertVerify = boolValue(raw.skipCertVerify)
      node.up = bandwidthValue(raw.up, 'up', '上行带宽')
      node.down = bandwidthValue(raw.down, 'down', '下行带宽')
    } else if (type === 'ss') {
      node.cipher = allowedCiphers.includes(raw.cipher) ? raw.cipher : 'aes-256-gcm'
      node.password = requireString(raw.password, 'password', '密码', 128)
      node.udp = boolValue(raw.udp, true)
    }

    nodes.push(node)
  })

  return nodes
}

/* ------------------------------------------------------------------ */
/* api                                                                 */
/* ------------------------------------------------------------------ */

async function handleApi(request, url, path, env) {
  if (path === '/api/auth') {
    if (request.method !== 'GET') return json({ error: '不支持的请求方法' }, 405)
    return await apiAuthStatus(env)
  }

  if (path === '/api/setup') {
    if (request.method !== 'POST') return json({ error: '不支持的请求方法' }, 405)
    return await apiSetup(request, env)
  }

  if (path === '/api/login') {
    if (request.method !== 'POST') return json({ error: '不支持的请求方法' }, 405)
    return await apiLogin(request, env)
  }

  const principal = await authenticateRequest(request, env)
  if (!principal) {
    return json({ error: '登录已失效，请重新登录' }, 401)
  }

  if (path === '/api/config') {
    if (request.method === 'GET') {
      const result = await readConfig(env)
      const view = await configForPrincipal(env, result.config, principal)
      return json({
        config: publicConfig(view.config),
        meta: await buildMeta(url, result, env, principal, view.personal),
      })
    }
    if (request.method === 'PUT') {
      requireOwner(principal)
      return await apiSave(request, url, env, principal)
    }
    return json({ error: '不支持的请求方法' }, 405)
  }

  if (path === '/api/nodes') {
    if (request.method !== 'PUT') return json({ error: '不支持的请求方法' }, 405)
    return await apiSavePersonalNodes(request, url, env, principal)
  }

  if (path === '/api/password') {
    if (request.method !== 'POST') return json({ error: '不支持的请求方法' }, 405)
    return await apiChangePassword(request, env, principal)
  }

  if (path === '/api/users' || path === '/api/users/update' || path === '/api/users/delete') {
    requireOwner(principal)
    return await apiUsers(request, path, env, principal)
  }

  if (path === '/api/preview') {
    if (request.method !== 'GET') return json({ error: '不支持的请求方法' }, 405)
    let result
    try {
      result = await readConfig(env)
    } catch (err) {
      result = { config: emptyConfig(), readonly: true, corrupted: false }
    }
    const view = await configForPrincipal(env, result.config, principal)
    return new Response(buildYaml(view.config), {
      headers: {
        ...baseHeaders(),
        'content-type': 'text/yaml;charset=UTF-8',
        'cache-control': 'no-store',
      },
    })
  }

  return json({ error: '接口不存在' }, 404)
}

async function apiAuthStatus(env) {
  const kv = !!kvBinding(env)
  let store = null
  let corrupted = false
  if (kv) {
    const result = await readUsersStore(env)
    store = result.store
    corrupted = !!result.corrupted
  }
  const recovery = !!dedicatedAdminToken(env)
  const openSetup = openSetupAllowed(env)
  return json({
    version: VERSION,
    kv,
    needsSetup: !store,
    // 初始化需要恢复令牌（配了 ADMIN_TOKEN 的实例）
    setupLocked: !store && recovery,
    // 初始化被完全拒绝：既没配 ADMIN_TOKEN，也没显式打开 ALLOW_OPEN_SETUP
    setupDisabled: !store && !recovery && !openSetup,
    recovery,
    allowOpenSetup: openSetup,
    corrupted,
    maxUsers: MAX_USERS,
  })
}

async function apiSetup(request, env) {
  const limited = checkLoginRateLimit(request, '__setup__')
  if (limited) return limited

  /* 闸门放在读请求体之前：被拒绝的请求不该消耗解析与校验成本，
     也不该通过错误码差异透露「这台实例到底能不能初始化」以外的东西。 */
  const result = await readUsersStore(env)
  if (result.store) return json({ error: '控制台已完成初始化，请直接登录' }, 409)
  // 用户库存在但解析失败：若放行初始化，任何访问者都能覆盖原数据并抢占管理员。
  // 恢复动作必须由持有 KV 写权限的人完成（删除 users 记录），而不是公开的 setup 接口。
  if (result.corrupted) {
    return json({
      error: '用户数据已损坏，出于安全考虑已阻止自动初始化。请先在 KV 中删除 users 记录，或使用 ADMIN_TOKEN 恢复后再初始化',
      corrupted: true,
    }, 409)
  }
  if (!kvBinding(env)) throw new HttpError(503, '尚未绑定 SUB_KV，无法创建管理员账号')

  const dedicated = dedicatedAdminToken(env)
  if (dedicated) {
    const supplied = bearerToken(request)
    if (!tokenEqual(supplied, dedicated)) {
      recordLoginFailure(request, '__setup__')
      return json({ error: '该实例已配置 ADMIN_TOKEN，请填写部署恢复令牌后再初始化', field: 'setupToken' }, 403)
    }
  } else if (!openSetupAllowed(env)) {
    // fail-closed：宁可不给部署者方便，也不能让任意访问者抢注所有者
    return json({
      error: '为避免实例被任意访问者抢占，初始化前请先在 Worker 的环境变量里配置 ADMIN_TOKEN（16 位以上随机字符串，建议写成 Secret），再打开本页初始化。确实需要开放初始化，可显式设置 ALLOW_OPEN_SETUP=1',
      setupDisabled: true,
    }, 503)
  }

  const body = await readJsonBody(request)
  const username = validateUsername(body.username)
  const password = validatePassword(body.password, username)

  const record = await buildPasswordRecord(password, passwordIterations(env))
  const user = {
    id: newUserId(),
    username,
    usernameKey: username.toLowerCase(),
    ...record,
    version: 1,
    createdAt: new Date().toISOString(),
    role: 'owner',
    scope: { allNodes: true, nodeIds: [] },
  }
  const store = {
    v: 1,
    rev: 1,
    secret: bytesToBase64Url(randomBytes(32)),
    users: [user],
    updatedAt: new Date().toISOString(),
  }
  await writeUsersStore(env, store)

  /* 走到这里说明没有 ADMIN_TOKEN（要么开了 ALLOW_OPEN_SETUP，要么从未配置）。
     提示一次，避免部署者误以为「已经安全」。 */
  if (!dedicated) {
    console.warn('控制台已通过开放初始化创建，但未配置 ADMIN_TOKEN：既没有忘记密码的恢复通道，也无法阻止后续的重复初始化尝试，建议立刻补一个 16 位以上的随机 Secret 并关闭 ALLOW_OPEN_SETUP')
  }

  // KV 没有条件写（CAS），并发初始化只能事后校验。新键的读是写后一致的，
  // 因此只有「读回来看见的正是别人刚建的那个账号」才能确定这次初始化输了，此时明确报错；
  // 读回为空（尚未同步 / 极端情况）不算失败，避免误伤正常的首次初始化。
  const verify = await readUsersStore(env)
  if (verify.store && verify.store.users.length && verify.store.users[0].id !== user.id) {
    console.error('Concurrent setup detected: admin created by another request wins for the reader')
    return json({
      error: '初始化已由另一个请求完成，请使用刚刚创建成功的账号登录；若无法登录在 KV 中删除 users 记录后重试',
      conflict: true,
    }, 409)
  }

  clearLoginFailures(request, '__setup__')

  const token = await createSessionToken(user, sessionKey(store, env), env)
  return json({ token, user: publicUser(user) })
}

async function apiLogin(request, env) {
  const body = await readJsonBody(request)
  // 先截断再进限流桶：否则超长用户名会按「每次不同」生成桶键，撑爆 isolate 内存
  const username = typeof body.username === 'string' ? body.username.trim().slice(0, USERNAME_MAX) : ''
  const password = typeof body.password === 'string' ? body.password : ''

  const limited = checkLoginRateLimit(request, username)
  if (limited) return limited

  const usersResult = await readUsersStore(env)
  if (!usersResult.store) {
    if (usersResult.corrupted) {
      return json({ error: '用户数据已损坏，无法登录。请在 Cloudflare KV 中修复或删除 users 记录', corrupted: true }, 500)
    }
    return json({ error: '控制台尚未初始化，请刷新页面创建管理员账号', needsSetup: true }, 403)
  }
  const store = usersResult.store

  const user = username
    ? store.users.find(item => item.usernameKey === username.toLowerCase())
    : null
  let ok = false
  if (user && password.length <= PASSWORD_MAX) {
    ok = await verifyPassword(password, user)
  } else {
    // 未知账号按库内最高迭代次数空转，避免响应时间暴露账号是否存在
    const rounds = store.users.reduce(
      (max, item) => Math.max(max, item.passwordIterations || PASSWORD_ITERATIONS),
      PASSWORD_ITERATIONS
    )
    await dummyPasswordCheck(password, rounds)
  }

  if (!ok) {
    recordLoginFailure(request, username)
    return json({ error: '用户名或密码不正确' }, 401)
  }
  clearLoginFailures(request, username)

  const token = await createSessionToken(user, sessionKey(store, env), env)
  return json({ token, user: publicUser(user) })
}

async function apiUsers(request, path, env, principal) {
  requireOwner(principal)
  if (path === '/api/users') {
    if (request.method === 'GET') {
      const result = await readUsersStore(env)
      if (!result.store) return usersStoreError(result)
      return json(usersResponse(result.store, principal))
    }
    if (request.method !== 'POST') return json({ error: '不支持的请求方法' }, 405)
    return await apiCreateUser(request, env, principal)
  }
  if (request.method !== 'POST') return json({ error: '不支持的请求方法' }, 405)
  if (path === '/api/users/update') return await apiUpdateUser(request, env, principal)
  return await apiDeleteUser(request, env, principal)
}

async function apiCreateUser(request, env, principal) {
  const body = await readJsonBody(request)
  const username = validateUsername(body.username)
  const password = validatePassword(body.password, username)
  const role = body.role === undefined ? 'member' : body.role
  if (!ROLES.includes(role)) throw new HttpError(400, '账号角色不正确', 'role')

  const result = await readUsersStore(env)
  if (!result.store) {
    if (result.readonly) throw new HttpError(503, '尚未绑定 KV 存储，无法创建用户')
    return usersStoreError(result)
  }
  const store = result.store
  if (body.rev !== undefined && Number(body.rev) !== store.rev) {
    return json({ error: '用户列表已在其他窗口更新，请刷新后重试', rev: store.rev }, 409)
  }
  if (store.users.length >= MAX_USERS) {
    return json({ error: `最多只能创建 ${MAX_USERS} 个用户` }, 400)
  }
  if (store.users.some(item => item.usernameKey === username.toLowerCase())) {
    return json({ error: '该用户名已存在', field: 'username' }, 400)
  }

  const record = await buildPasswordRecord(password, passwordIterations(env))
  const user = {
    id: newUserId(),
    username,
    usernameKey: username.toLowerCase(),
    ...record,
    version: 1,
    createdAt: new Date().toISOString(),
    role,
    // 新成员默认不分配节点；所有者天然拥有全部节点
    scope: role === 'owner' ? { allNodes: true, nodeIds: [] } : validateScope(body.scope || {}),
  }
  const next = {
    ...store,
    rev: store.rev + 1,
    users: store.users.concat(user),
    updatedAt: new Date().toISOString(),
  }
  await writeUsersStore(env, next)
  return json(usersResponse(next, principal))
}

async function apiUpdateUser(request, env, principal) {
  const body = await readJsonBody(request)
  const id = typeof body.id === 'string' ? body.id.slice(0, 64) : ''
  // 密码留空表示不修改（账号范围 / 角色的调整不应强制所有者重设密码）
  const password = body.password === undefined || body.password === null || body.password === ''
    ? ''
    : validatePassword(body.password, '')
  if (body.role !== undefined && !ROLES.includes(body.role)) {
    throw new HttpError(400, '账号角色不正确', 'role')
  }

  const usersResult = await readUsersStore(env)
  if (!usersResult.store) return usersStoreError(usersResult)
  const store = usersResult.store
  if (body.rev !== undefined && Number(body.rev) !== store.rev) {
    return json({ error: '用户列表已在其他窗口更新，请刷新后重试', rev: store.rev }, 409)
  }
  const target = store.users.find(item => item.id === id)
  if (!target) return json({ error: '用户不存在或已被删除' }, 404)

  const role = body.role === undefined ? target.role : body.role
  if (target.role === 'owner' && role !== 'owner'
    && store.users.filter(item => item.role === 'owner').length <= 1) {
    return json({ error: '至少需要保留一个所有者账号' }, 400)
  }
  let scope
  if (role === 'owner') {
    scope = { allNodes: true, nodeIds: [] }
  } else if (body.scope !== undefined) {
    scope = validateScope(body.scope)
  } else if (target.role === 'member') {
    scope = target.scope
  } else {
    // 从所有者降为成员且未指定范围：默认不分配节点，避免越权
    scope = { allNodes: false, nodeIds: [] }
  }

  let updated = { ...target, role, scope }
  if (password) {
    const record = await buildPasswordRecord(password, passwordIterations(env))
    updated = { ...updated, ...record, version: target.version + 1 }
  }
  const next = {
    ...store,
    rev: store.rev + 1,
    users: store.users.map(item => item.id === id ? updated : item),
    updatedAt: new Date().toISOString(),
  }
  await writeUsersStore(env, next)

  const response = usersResponse(next, principal)
  if (password && principal.kind === 'session' && principal.userId === id) {
    response.token = await createSessionToken(updated, sessionKey(next, env), env)
  }
  return json(response)
}

async function apiDeleteUser(request, env, principal) {
  const body = await readJsonBody(request)
  const id = typeof body.id === 'string' ? body.id.slice(0, 64) : ''

  const usersResult = await readUsersStore(env)
  if (!usersResult.store) return usersStoreError(usersResult)
  const store = usersResult.store
  if (body.rev !== undefined && Number(body.rev) !== store.rev) {
    return json({ error: '用户列表已在其他窗口更新，请刷新后重试', rev: store.rev }, 409)
  }
  const target = store.users.find(item => item.id === id)
  if (!target) return json({ error: '用户不存在或已被删除' }, 404)
  if (store.users.length <= 1) return json({ error: '至少需要保留一个管理员账号' }, 400)
  if (principal.kind === 'session' && principal.userId === id) {
    return json({ error: '不能删除当前登录账号，请使用其他账号操作' }, 400)
  }
  if (target.role === 'owner' && store.users.filter(item => item.role === 'owner').length <= 1) {
    return json({ error: '至少需要保留一个所有者账号' }, 400)
  }

  const next = {
    ...store,
    rev: store.rev + 1,
    users: store.users.filter(item => item.id !== id),
    updatedAt: new Date().toISOString(),
  }
  await writeUsersStore(env, next)
  await deletePersonalNodes(env, id)
  return json(usersResponse(next, principal))
}

/* 成员自助改密：需要当前密码，成功后 version+1。
   version 同时参与会话与账号订阅令牌的派生，因此旧登录与旧订阅链接会一起失效，
   响应里返回新的会话令牌，前端无需重新登录。 */
async function apiChangePassword(request, env, principal) {
  if (principal.kind !== 'session' || !principal.userId) {
    throw new HttpError(403, '部署恢复令牌无需修改密码')
  }
  const body = await readJsonBody(request)
  const current = typeof body.currentPassword === 'string' ? body.currentPassword : ''
  const nextPassword = validatePassword(body.newPassword, principal.username)

  const limitKey = '__password__|' + principal.username
  const limited = checkLoginRateLimit(request, limitKey)
  if (limited) return limited

  const result = await readUsersStore(env)
  if (!result.store) return usersStoreError(result)
  const store = result.store
  if (body.rev !== undefined && Number(body.rev) !== store.rev) {
    return json({ error: '账号信息已在其他窗口更新，请刷新后重试', rev: store.rev }, 409)
  }
  const target = store.users.find(item => item.id === principal.userId)
  if (!target) return json({ error: '账号不存在或已被删除' }, 404)

  const ok = current.length <= PASSWORD_MAX && await verifyPassword(current, target)
  if (!ok) {
    recordLoginFailure(request, limitKey)
    return json({ error: '当前密码不正确', field: 'currentPassword' }, 400)
  }
  clearLoginFailures(request, limitKey)

  const record = await buildPasswordRecord(nextPassword, passwordIterations(env))
  const updated = { ...target, ...record, version: target.version + 1 }
  const next = {
    ...store,
    rev: store.rev + 1,
    users: store.users.map(item => item.id === target.id ? updated : item),
    updatedAt: new Date().toISOString(),
  }
  await writeUsersStore(env, next)

  const token = await createSessionToken(updated, sessionKey(next, env), env)
  return json({ token, user: publicUser(updated) })
}

/* 边读边计数：content-length 可以缺失，也可以故意写小，
   只有读到超过上限时立刻取消，才不会把 100MB 请求体整块读进内存。 */
async function readBodyLimited(request, max) {
  const body = request.body
  if (!body || typeof body.getReader !== 'function') {
    const text = await request.text()
    if (new TextEncoder().encode(text).length > max) throw new HttpError(413, '提交的数据过大')
    return text
  }

  const reader = body.getReader()
  const chunks = []
  let total = 0
  try {
    for (;;) {
      const step = await reader.read()
      if (step.done) break
      const chunk = step.value
      total += chunk.byteLength
      if (total > max) {
        try {
          await reader.cancel()
        } catch (cancelErr) {
          console.warn('Request body cancel failed:', cancelErr)
        }
        throw new HttpError(413, '提交的数据过大')
      }
      chunks.push(chunk)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch (releaseErr) {
      console.warn('Request body release failed:', releaseErr)
    }
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

async function readJsonBody(request) {
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > MAX_BODY) throw new HttpError(413, '提交的数据过大')
  const raw = await readBodyLimited(request, MAX_BODY)

  let body
  try {
    body = JSON.parse(raw)
  } catch (err) {
    throw new HttpError(400, '请求数据格式错误')
  }
  if (!body || typeof body !== 'object') throw new HttpError(400, '请求数据格式错误')
  return body
}

/* 下发给控制器的配置：订阅令牌只以掩码形式出现在 meta 里。
   令牌本身就是订阅凭据，没有必要在每个读写响应里平铺明文——
   它会随「复制响应体」进入剪贴板、日志与浏览器历史，而订阅链接（meta.subUrl）
   才是产品需要展示的那一份。 */
function publicConfig(config) {
  const { authToken, ...rest } = config
  return rest
}

function maskedAuthToken(config, env) {
  const token = storedAuthToken(config) || authToken(env)
  if (!token) return null
  // 过短的令牌不显示末位：4 位尾码在 9 位以下的令牌里已经是可用信息的主要部分
  if (token.length < AUTH_TOKEN_MIN) return '•'.repeat(8)
  const tail = token.slice(-4)
  return '•'.repeat(Math.max(6, Math.min(token.length - 4, 24))) + tail
}

async function apiSave(request, url, env, principal) {
  requireOwner(principal)
  const body = await readJsonBody(request)

  const current = await readConfig(env, { seed: true })
  if (current.readonly) {
    throw new HttpError(503, '尚未绑定 KV 存储，配置为只读模式。请先绑定 SUB_KV 后重试')
  }
  if (body.rev !== undefined && body.rev !== null && Number(body.rev) !== current.config.rev) {
    return json({
      error: '配置已在其他窗口被更新，请刷新后重试',
      rev: current.config.rev,
    }, 409)
  }

  const nodes = validateNodes(body.nodes)
  const defaults = body.defaults !== undefined
    ? validateDefaults(body.defaults)
    : sanitizeDefaults(current.config.defaults)
  const providerBase = body.providerBase !== undefined
    ? validateProviderBase(body.providerBase)
    : sanitizeProviderBase(current.config.providerBase)
  const regionOrder = reconcileRegionOrder(
    body.regionOrder !== undefined ? body.regionOrder : current.config.regionOrder,
    nodes
  )
  const subscription = body.subscription !== undefined
    ? sanitizeSubscription(body.subscription)
    : sanitizeSubscription(current.config.subscription)
  let authToken = storedAuthToken(current.config)
  if (body.authToken !== undefined) {
    if (body.authToken === null) {
      // 显式清除：删除设置页令牌，回退到环境变量 AUTH_TOKEN（都没有则订阅需要重新配置）
      authToken = ''
    } else {
      const candidate = validateAuthToken(body.authToken)
      // 空值表示沿用当前令牌，避免误清空后无法登录或生成订阅链接
      if (candidate) authToken = candidate
    }
  }
  const next = {
    v: 1,
    rev: (current.config.rev || 0) + 1,
    updatedAt: new Date().toISOString(),
    nodes,
    defaults,
    regionOrder,
    subscription,
    providerBase,
    authToken,
  }
  await writeConfig(env, next)

  return json({
    config: publicConfig(next),
    meta: await buildMeta(url, { readonly: false, corrupted: false, config: next }, env, principal),
  })
}

/* 成员的节点写路径：只接受个人节点，全部落到 user_nodes:<userId>，
   管理员配置的 rev / updatedAt / nodes 都不会被触碰。
   提交里混入的 n_ 节点 id 一律重写为 p_，因此无法借保存覆盖已分配节点。 */
async function apiSavePersonalNodes(request, url, env, principal) {
  if (isOwner(principal)) throw new HttpError(400, '所有者请通过配置接口保存节点')
  if (!principal.userId) throw new HttpError(403, '当前会话不能保存个人节点')

  const body = await readJsonBody(request)
  if (!Array.isArray(body.nodes)) throw new HttpError(400, '节点数据格式不正确')
  if (body.nodes.length > MAX_PERSONAL_NODES) {
    throw new HttpError(400, `个人节点数量不能超过 ${MAX_PERSONAL_NODES} 个`)
  }

  const admin = await readConfig(env)
  if (admin.readonly) throw new HttpError(503, '尚未绑定 KV 存储，无法保存')
  const current = await readPersonalNodes(env, principal.userId)
  if (body.rev !== undefined && body.rev !== null && Number(body.rev) !== current.rev) {
    return json({ error: '个人节点已在其他窗口更新，请刷新后重试', rev: current.rev }, 409)
  }

  const nodes = validateNodes(body.nodes)
  const adminIds = new Set(admin.config.nodes.map(node => node.id))
  const usedIds = new Set()
  const prepared = nodes.map(node => {
    let id = PERSONAL_ID_RE.test(node.id) && !adminIds.has(node.id) && !usedIds.has(node.id)
      ? node.id
      : ''
    if (!id) {
      do { id = 'p_' + crypto.randomUUID() } while (adminIds.has(id) || usedIds.has(id))
    }
    usedIds.add(id)
    return id === node.id ? node : { ...node, id }
  })

  const next = {
    v: 1,
    rev: (current.rev || 0) + 1,
    updatedAt: new Date().toISOString(),
    nodes: prepared,
  }
  await writePersonalNodes(env, principal.userId, next)

  const filtered = filterConfigForPrincipal(admin.config, principal)
  const merged = { ...filtered, nodes: mergePersonalNodes(filtered.nodes, prepared) }
  return json({
    config: publicConfig(merged),
    meta: await buildMeta(url, admin, env, principal, { ...next, corrupted: false }),
  })
}

/* 成员的 meta 只暴露自己的订阅链接：全局 AUTH_TOKEN 是「全部节点」凭据，
   不能因为成员登录就下发到他的浏览器里。 */
async function buildMeta(url, result, env, principal, personal) {
  const stored = storedAuthToken(result.config)
  const envToken = authToken(env)
  const auth = stored || envToken
  const owner = isOwner(principal)
  const role = owner ? 'owner' : 'member'
  const accountToken = !owner && principal ? principal.subscriptionToken : null
  const subToken = owner ? auth : accountToken
  const personalNodes = personal && Array.isArray(personal.nodes) ? personal.nodes : []
  return {
    version: VERSION,
    kv: !!kvBinding(env),
    readonly: !!result.readonly,
    corrupted: !!result.corrupted,
    hasAuthToken: owner ? !!auth : !!accountToken,
    // 令牌来源与掩码末位足够前端判断状态，明文只在订阅链接里出现一次
    authSource: owner ? (stored ? 'settings' : (envToken ? 'environment' : 'none')) : 'account',
    authTokenHint: subToken ? maskedAuthToken({ authToken: subToken }, env) : null,
    subUrl: subToken ? `${url.origin}/?token=${encodeURIComponent(subToken)}` : null,
    authType: principal ? principal.kind : null,
    username: principal ? principal.username : null,
    userId: principal && principal.userId ? principal.userId : null,
    role,
    // 成员也能写自己的节点，但只能落到 user_nodes:<id>，碰不到管理员配置
    canWrite: !!kvBinding(env) && !result.readonly,
    canManageUsers: owner,
    scope: principal && principal.scope
      ? { allNodes: !!principal.scope.allNodes, nodeIds: principal.scope.nodeIds.slice() }
      : { allNodes: true, nodeIds: [] },
    personalNodeIds: personalNodes.map(node => node.id),
    personalRev: personal ? personal.rev : 0,
    personalCount: personalNodes.length,
    maxPersonalNodes: MAX_PERSONAL_NODES,
    personalCorrupted: !!(personal && personal.corrupted),
  }
}

function json(data, status = 200, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...baseHeaders(),
      'content-type': 'application/json;charset=UTF-8',
      'cache-control': 'no-store',
      ...(extraHeaders || {}),
    },
  })
}

/* ------------------------------------------------------------------ */
/* rate limiting (best-effort, per-isolate)                             */
/*                                                                     */
/* 给管理接口加一层轻量限流：同一出口 IP 每分钟最多 120 次 /api 请求， */
/* 超过返回 429 + Retry-After。Worker 内存是按 isolate 隔离的，       */
/* 因此这是尽力而为的防护；如需严格限流，请在 Cloudflare 控制台       */
/* 为 /api/* 配置边缘 Rate Limiting 规则（见 README）。               */
/* ------------------------------------------------------------------ */

const API_RATE_WINDOW_MS = 60 * 1000
const API_RATE_MAX = 120
/* 订阅路径：客户端会周期性刷新，阈值放宽到 240/分钟，只用于挡住令牌爆破 */
const SUB_RATE_MAX = 240
const apiRateBuckets = new Map()

const LOGIN_RATE_WINDOW_MS = 10 * 60 * 1000
const LOGIN_RATE_MAX = 8
/* 同一 IP 针对「任意用户名」的失败总闸：挡住换用户名批量试密码（password spraying） */
const LOGIN_IP_RATE_MAX = 60
const LOGIN_IP_BUCKET = '__ip__'
const loginFailureBuckets = new Map()

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'unknown'
}

function loginBucketKey(request, username) {
  return clientIp(request) + '|' + String(username || '').toLowerCase()
}

function loginIpBucketKey(request) {
  return clientIp(request) + '|' + LOGIN_IP_BUCKET
}

function loginBucketLimited(key, max, now) {
  const bucket = loginFailureBuckets.get(key)
  if (!bucket) return 0
  if (now - bucket.start >= LOGIN_RATE_WINDOW_MS) {
    loginFailureBuckets.delete(key)
    return 0
  }
  if (bucket.fails < max) return 0
  return Math.max(1, Math.ceil((LOGIN_RATE_WINDOW_MS - (now - bucket.start)) / 1000))
}

function checkLoginRateLimit(request, username) {
  const now = Date.now()
  const retryAfter = loginBucketLimited(loginBucketKey(request, username), LOGIN_RATE_MAX, now) ||
    loginBucketLimited(loginIpBucketKey(request), LOGIN_IP_RATE_MAX, now)
  if (!retryAfter) return null
  return json({ error: '尝试次数过多，请稍后再试' }, 429, { 'retry-after': String(retryAfter) })
}

function bumpLoginBucket(key, now) {
  let bucket = loginFailureBuckets.get(key)
  if (!bucket || now - bucket.start >= LOGIN_RATE_WINDOW_MS) {
    bucket = { start: now, fails: 0 }
    loginFailureBuckets.set(key, bucket)
  }
  bucket.fails += 1
}

function recordLoginFailure(request, username) {
  const now = Date.now()
  bumpLoginBucket(loginBucketKey(request, username), now)
  bumpLoginBucket(loginIpBucketKey(request), now)
  if (loginFailureBuckets.size > 2000) {
    for (const [item, value] of loginFailureBuckets) {
      if (now - value.start >= LOGIN_RATE_WINDOW_MS) loginFailureBuckets.delete(item)
      if (loginFailureBuckets.size <= 1000) break
    }
  }
}

/* 只清除该账号的失败计数：按 IP 的总闸不因某次成功而放行，否则批量试探可被一次正确登录洗白 */
function clearLoginFailures(request, username) {
  loginFailureBuckets.delete(loginBucketKey(request, username))
}

function rateLimit(request, keyPrefix, max) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
  const key = keyPrefix + ip
  const now = Date.now()
  let bucket = apiRateBuckets.get(key)
  if (!bucket || now - bucket.start >= API_RATE_WINDOW_MS) {
    bucket = { start: now, count: 0 }
    apiRateBuckets.set(key, bucket)
  }
  if (apiRateBuckets.size > 2000) {
    for (const [item, value] of apiRateBuckets) {
      if (now - value.start >= API_RATE_WINDOW_MS) apiRateBuckets.delete(item)
      if (apiRateBuckets.size <= 1000) break
    }
  }
  bucket.count += 1
  if (bucket.count > max) {
    const retryAfter = Math.max(1, Math.ceil((API_RATE_WINDOW_MS - (now - bucket.start)) / 1000))
    return json({ error: '请求过于频繁，请稍后再试' }, 429, { 'retry-after': String(retryAfter) })
  }
  return null
}

/* Cloudflare 边缘限流（跨 isolate 生效，需在 wrangler.toml 里声明 [[ratelimits]]）。
   内存桶按 isolate 计数，攻击者换个 isolate 就能重置；边缘限流才是真正按 IP 计的。
   绑定缺失或调用失败一律返回 null 交给内存桶兜底——限流组件故障不能把正常请求拒掉。 */
async function edgeRateLimit(env, bindingName, scope, request) {
  const limiter = env && env[bindingName]
  if (!limiter || typeof limiter.limit !== 'function') return null
  try {
    const verdict = await limiter.limit({ key: scope + ':' + clientIp(request) })
    if (!verdict || verdict.success !== false) return null
    return json({ error: '请求过于频繁，请稍后再试' }, 429, { 'retry-after': '60' })
  } catch (err) {
    console.error('Edge rate limiter failed, falling back to memory bucket:', err)
    return null
  }
}

async function checkApiRateLimit(request, env) {
  const edge = await edgeRateLimit(env, 'RATE_LIMITER', 'api', request)
  if (edge) return edge
  return rateLimit(request, 'api:', API_RATE_MAX)
}

/* 订阅拉取单独计数：客户端会周期性刷新，阈值放宽，仅用于挡住令牌爆破 */
async function checkSubRateLimit(request, env) {
  const edge = await edgeRateLimit(env, 'SUB_RATE_LIMITER', 'sub', request)
  if (edge) return edge
  return rateLimit(request, 'sub:', SUB_RATE_MAX)
}

function baseHeaders() {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    // includeSubDomains 让自定义域名下的子域也强制 HTTPS；workers.dev 属于公共后缀，不受影响
    'strict-transport-security': 'max-age=15552000; includeSubDomains',
  }
}

/* HTML 页面专用：不响应 CORS，禁用一切内嵌能力，并显式声明不需要的浏览器特性 */
function htmlHeaders() {
  return {
    ...baseHeaders(),
    'cross-origin-resource-policy': 'same-origin',
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
  }
}

/* HEAD 请求保留完整头部（含 content-length 语义由运行时处理），但不发送正文 */
function pageBody(headOnly, html) {
  return headOnly ? null : html
}

/* ------------------------------------------------------------------ */
/* subscription                                                        */
/* ------------------------------------------------------------------ */

async function serveSubscription(env, config, headOnly = false) {
  if (!config) {
    try {
      config = (await readConfig(env)).config
    } catch (err) {
      console.error('Subscription fallback to empty config:', err)
      config = emptyConfig()
    }
  }

  const headers = {
    ...baseHeaders(),
    'content-type': 'text/yaml;charset=UTF-8',
    'cache-control': 'no-store, max-age=0',
    'profile-update-interval': '12',
    // 订阅 URL 自带令牌，任何索引 / 抓取都会把它抄进第三方缓存
    'x-robots-tag': 'noindex, nofollow, noarchive',
    ...subscriptionHeaders(config),
    'access-control-allow-origin': '*',
  }
  // HEAD 用于客户端探活（令牌是否仍然有效）：不渲染 YAML，只回头部
  if (headOnly) return new Response(null, { status: 200, headers })

  return new Response(buildYaml(config), { headers })
}

// 未配置流量 / 到期时间时不发送 subscription-userinfo，避免客户端显示虚构额度
function subscriptionHeaders(config) {
  const info = config.subscription || {}
  const totalGB = Number(info.totalGB)
  const expire = info.expire ? Math.floor(Date.parse(`${info.expire}T23:59:59Z`) / 1000) : 0
  if (!(totalGB > 0) && !expire) return {}
  const parts = ['upload=0', 'download=0']
  parts.push(`total=${totalGB > 0 ? Math.round(totalGB * 1024 * 1024 * 1024) : 0}`)
  if (expire) parts.push(`expire=${expire}`)
  return { 'subscription-userinfo': parts.join('; ') }
}

function buildYaml(config) {
  const enabled = config.nodes.filter(node => node.enabled)
  const renderable = enabled.filter(isRenderableNode)
  if (renderable.length !== enabled.length) {
    console.warn('Skipped invalid nodes while rendering YAML:', enabled.length - renderable.length)
  }
  const time = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(new Date()).replace(/\//g, '-')

  const info = config.subscription || {}
  const infoBits = []
  if (Number(info.totalGB) > 0) infoBits.push(`流量 ${info.totalGB} GB`)
  if (info.expire) infoBits.push(`到期 ${info.expire}`)

  const header = [
    '# ============================================================',
    '# Transit Hub · Clash Subscription',
    `# 更新时间: ${time} (Asia/Shanghai)`,
    `# 节点: ${config.nodes.length} 个 · 已启用: ${enabled.length} 个`,
    ...(infoBits.length ? [`# ${infoBits.join(' · ')}`] : []),
    '# 由 Transit Hub Console 自动生成，请勿手动编辑',
    '# ============================================================',
    '',
  ].join('\n')

  const proxies = renderable.map(nodeToYaml).join('\n')
  // 策略组只引用实际渲染出来的节点，否则 Clash 会因 proxy not found 报错
  const groups = buildProxyGroups({ ...config, nodes: renderable }).map(groupToYaml).join('\n')
  const proxySection = renderable.length ? ['proxies:', proxies] : ['proxies: []']

  // rule-providers 镜像：只替换固定的规则集前缀，未配置时保持默认 CDN
  const base = sanitizeProviderBase(config.providerBase) || PROVIDER_BASE_DEFAULT
  const rules = base === PROVIDER_BASE_DEFAULT
    ? STATIC_RULES.trim()
    : STATIC_RULES.trim().split(PROVIDER_BASE_DEFAULT).join(base)

  return [
    header,
    STATIC_HEAD.trimEnd(),
    '',
    '# 节点',
    ...proxySection,
    '',
    '# 策略组',
    'proxy-groups:',
    groups,
    '',
    rules,
    '',
  ].join('\n')
}

function yq(value) {
  return JSON.stringify(String(value))
}

/**
 * 渲染前的最后一道防线。
 * KV 里可能存在旧版本写入、手工编辑或竞态产生的异常数据，读路径不会再跑一遍
 * validateNodes，所以这里必须自行兜底：枚举字段只允许白名单值，凭据字段必须真的是凭据，
 * 否则整节点跳过，避免把含换行的值或 "undefined" 拼进 YAML 造成结构破坏、字段注入，
 * 或者下发一份客户端必然连不上的配置。
 */
function safeEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isRenderableNode(node) {
  if (!node || typeof node !== 'object') return false
  if (!TYPES.includes(node.type)) return false
  if (!Number.isInteger(node.port) || node.port < 1 || node.port > 65535) return false
  if (typeof node.server !== 'string' || !node.server || node.server.length > 253) return false
  if (typeof node.name !== 'string' || !node.name || node.name.length > 80) return false
  if (/[\u0000-\u001f\u007f]/.test(node.name) || /[\u0000-\u001f\u007f]/.test(node.server)) return false
  // 渲染前的最后一道：零宽 / 双向控制符会让客户端列表里出现「看着一样、其实不同」的节点名
  if (FORMAT_CHARS_RE.test(node.name) || FORMAT_CHARS_RE.test(node.server)) return false

  if (node.type === 'vless' || node.type === 'vmess') {
    if (typeof node.uuid !== 'string' || !UUID_SHAPE.test(node.uuid)) return false
    // Reality 缺公钥等于连不上：跳过而不是下发 public-key: "undefined"
    if (node.type === 'vless' && node.reality && (typeof node.publicKey !== 'string' || !node.publicKey)) return false
    return true
  }
  if (typeof node.password !== 'string' || !node.password || /[\u0000-\u001f\u007f]/.test(node.password)) return false
  if (node.type === 'ss' && !CIPHERS.includes(node.cipher)) return false
  return true
}

function nodeToYaml(node) {
  const lines = [
    `- name: ${yq(node.name)}`,
    `  type: ${safeEnum(node.type, TYPES, 'vless')}`,
    `  server: ${yq(node.server)}`,
    `  port: ${Number.isInteger(node.port) ? node.port : 443}`,
  ]

  if (node.type === 'vless') {
    lines.push(`  uuid: ${yq(node.uuid)}`)
    lines.push(`  network: ${safeEnum(node.network, NETWORKS, 'tcp')}`)
    if (node.network === 'ws') {
      lines.push('  ws-opts:')
      lines.push(`    path: ${yq(node.wsPath || '/')}`)
      if (node.wsHost) {
        lines.push('    headers:')
        lines.push(`      Host: ${yq(node.wsHost)}`)
      }
    }
    if (node.network === 'grpc' && node.grpcService) {
      lines.push('  grpc-opts:')
      lines.push(`    grpc-service-name: ${yq(node.grpcService)}`)
    }
    if (node.udp) lines.push('  udp: true')
    if (node.tls || node.reality) lines.push('  tls: true')
    if (node.flow && node.network === 'tcp' && node.tls) lines.push(`  flow: ${safeEnum(node.flow, FLOWS, '')}`)
    if (node.servername && (node.tls || node.reality)) lines.push(`  servername: ${yq(node.servername)}`)
    if (node.reality) {
      lines.push('  reality-opts:')
      lines.push(`    public-key: ${yq(node.publicKey)}`)
      if (node.shortId) lines.push(`    short-id: ${yq(node.shortId)}`)
    }
    if (node.fingerprint) lines.push(`  client-fingerprint: ${safeEnum(node.fingerprint, FINGERPRINTS, 'chrome')}`)
    return lines.join('\n')
  }

  if (node.type === 'vmess') {
    lines.push(`  uuid: ${yq(node.uuid)}`)
    lines.push('  alterId: 0')
    lines.push('  cipher: auto')
    lines.push(`  network: ${safeEnum(node.network, NETWORKS, 'tcp')}`)
    if (node.network === 'ws') {
      lines.push('  ws-opts:')
      lines.push(`    path: ${yq(node.wsPath || '/')}`)
      if (node.wsHost) {
        lines.push('    headers:')
        lines.push(`      Host: ${yq(node.wsHost)}`)
      }
    }
    if (node.network === 'grpc' && node.grpcService) {
      lines.push('  grpc-opts:')
      lines.push(`    grpc-service-name: ${yq(node.grpcService)}`)
    }
    if (node.udp) lines.push('  udp: true')
    if (node.tls) lines.push('  tls: true')
    if (node.servername && node.tls) lines.push(`  servername: ${yq(node.servername)}`)
    return lines.join('\n')
  }

  if (node.type === 'trojan') {
    lines.push(`  password: ${yq(node.password)}`)
    if (node.sni) lines.push(`  sni: ${yq(node.sni)}`)
    if (node.skipCertVerify) lines.push('  skip-cert-verify: true')
    if (node.udp) lines.push('  udp: true')
    return lines.join('\n')
  }

  if (node.type === 'hysteria2') {
    lines.push(`  password: ${yq(node.password)}`)
    lines.push('  quic:')
    lines.push('    initStreamReceiveWindow: 8388608')
    lines.push('    maxStreamReceiveWindow: 8388608')
    lines.push('    initConnReceiveWindow: 20971520')
    lines.push('    maxConnReceiveWindow: 20971520')
    lines.push('    maxIdleTimeout: 30s')
    lines.push('    maxIncomingStreams: 1024')
    lines.push('    disablePathMTUDiscovery: false')
    if (node.up || node.down) {
      lines.push('  bandwidth:')
      if (node.up) lines.push(`    up: ${yq(node.up)}`)
      if (node.down) lines.push(`    down: ${yq(node.down)}`)
    }
    if (node.sni) lines.push(`  sni: ${yq(node.sni)}`)
    if (node.skipCertVerify) lines.push('  skip-cert-verify: true')
    return lines.join('\n')
  }

  if (node.type === 'ss') {
    lines.push(`  cipher: ${safeEnum(node.cipher, CIPHERS, 'aes-256-gcm')}`)
    lines.push(`  password: ${yq(node.password)}`)
    if (node.udp) lines.push('  udp: true')
    return lines.join('\n')
  }

  return lines.join('\n')
}

function buildProxyGroups(config) {
  const enabled = config.nodes.filter(node => node.enabled)
  const buckets = []

  REGION_ORDER.forEach(key => {
    const inRegion = enabled.filter(node => node.region === key)
    if (inRegion.length) {
      // 各分组按独立的 regionOrder 排序，未收录的节点保持全局相对顺序（sort 稳定）
      const rank = new Map((((config.regionOrder || {})[key]) || []).map((id, i) => [id, i]))
      const far = Number.MAX_SAFE_INTEGER
      const members = inRegion
        .slice()
        .sort((a, b) => {
          const ra = rank.has(a.id) ? rank.get(a.id) : far
          const rb = rank.has(b.id) ? rank.get(b.id) : far
          return ra - rb
        })
        .map(node => node.name)
      buckets.push({ key, name: REGION_META[key].group, icon: REGION_META[key].icon, members })
    }
  })

  const mainProxies = [
    'DIRECT',
    ...buckets.map(bucket => bucket.name),
    ...enabled.filter(node => node.showInMain !== false).map(node => node.name),
  ]
  const groups = [{
    name: MAIN_GROUP,
    icon: 'https://fastly.jsdelivr.net/gh/Koolson/Qure/IconSet/Color/Global.png',
    proxies: mainProxies,
  }]

  buckets.forEach(bucket => {
    groups.push({ name: bucket.name, icon: bucket.icon, proxies: bucket.members })
  })

  const availableBuckets = new Set(buckets.map(bucket => bucket.name))

  APP_GROUPS.forEach(app => {
    const proxies = []
    const push = value => {
      if (value && !proxies.includes(value)) proxies.push(value)
    }
    app.bases.forEach(base => {
      if (base === MAIN_GROUP || availableBuckets.has(base)) push(base)
    })
    enabled.forEach(node => {
      // tags 可能来自旧数据 / 手工编辑的 KV，缺字段不能让整份订阅 500
      if (Array.isArray(node.tags) && node.tags.includes(app.key)) push(node.name)
    })
    if (!proxies.length) push(MAIN_GROUP)
    groups.push({ name: app.name, icon: app.icon, proxies })
  })

  return groups
}

function groupToYaml(group) {
  const lines = [`- name: ${yq(group.name)}`]
  if (group.icon) lines.push(`  icon: ${yq(group.icon)}`)
  lines.push('  type: select')
  lines.push('  proxies:')
  group.proxies.forEach(proxy => lines.push(`    - ${yq(proxy)}`))
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* admin page                                                          */
/* ------------------------------------------------------------------ */

function serveAdmin(headOnly = false) {
  const nonce = randomNonce()
  const html = ADMIN_HTML.split('__CSP_NONCE__').join(nonce)
  return new Response(pageBody(headOnly, html), {
    headers: {
      ...htmlHeaders(),
      'content-type': 'text/html;charset=UTF-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'content-security-policy': [
        "default-src 'none'",
        `script-src 'nonce-${nonce}'`,
        `style-src 'nonce-${nonce}'`,
        "img-src 'self' data:",
        "connect-src 'self'",
        "font-src 'self'",
        "object-src 'none'",
        "worker-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    },
  })
}

function randomNonce() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

/* ------------------------------------------------------------------ */
/* decoy page                                                          */
/* ------------------------------------------------------------------ */

function decoyCsp(nonce) {
  // default-src 'none' 已覆盖 object / worker / connect，这里只显式列出可能被放宽的指令。
  // style 也用 nonce 而不是 'unsafe-inline'：样式内联一旦放开，CSS 选择器 + 外部 url()
  // 就能在不执行脚本的前提下把页面里的属性值一位一位漏出去。
  return "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'nonce-" + nonce + "'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
}

function renderDecoy(request, headOnly = false) {
  const headers = request.headers
  const nonce = randomNonce()
  // HEAD 只要状态与头部：跳过整页模板拼装，省掉最贵的一段 CPU
  if (headOnly) {
    return new Response(null, {
      status: 200,
      headers: {
        ...htmlHeaders(),
        'content-type': 'text/html;charset=UTF-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow',
        // HEAD 不返回正文，但头部仍与 GET 保持一致，避免探测差异
        'content-security-policy': decoyCsp(nonce),
      },
    })
  }
  const cf = request.cf || {}
  const known = value => (value === undefined || value === null || value === '' ? '' : String(value))
  const or = (value, label) => known(value) || label

  const ip = or(headers.get('cf-connecting-ip'), '未知')
  const country = or(cf.country, '未知')
  const city = or(cf.city, '未知')
  const isp = or(cf.asOrganization, '未知运营商')
  const colo = or(cf.colo, '未知节点')
  const ua = headers.get('user-agent') || '未知浏览器'
  const location = [city, country].filter(value => value && value !== '未知').join(', ') || '未知'
  const version = /:/.test(ip) ? 'IPv6' : 'IPv4'
  const uaShort = ua.length > 120 ? ua.slice(0, 120) + '…' : ua

  const net = {
    ip,
    version,
    country: or(cf.country, ''),
    region: or(cf.region, ''),
    continent: or(cf.continent, ''),
    postal: or(cf.postalCode, ''),
    lat: or(cf.latitude, ''),
    lon: or(cf.longitude, ''),
    timezone: or(cf.timezone, ''),
    asn: or(cf.asn, ''),
    isp,
    colo,
    tls: or(cf.tlsVersion, ''),
    cipher: or(cf.tlsCipher, ''),
    httpProtocol: or(cf.httpProtocol, ''),
    tcpPort: or(cf.clientTcpPort, ''),
    keepAlive: or(headers.get('keep-alive'), ''),
    priority: or(headers.get('priority'), ''),
    acceptLanguage: ua === '未知浏览器' ? '' : or(headers.get('accept-language'), ''),
    cfRay: or(headers.get('cf-ray'), ''),
    ua,
  }
  const row = (label, value, id) => {
    const text = known(value)
    if (!text) return ''
    return '<div class="row"><dt>' + esc(label) + '</dt><dd' +
      (id ? ' id="' + id + '"' : '') + ' data-copy="' + esc(label) + '">' + esc(text) + '</dd></div>'
  }

  /* 请求头白名单取值：不回显 cookie / authorization，折叠控制字符并按 120 字符截断 */
  const hdr = (name, label) => {
    const raw = known(headers.get(name))
    if (!raw) return ''
    const flat = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/ {2,}/g, ' ').trim()
    if (!flat) return ''
    return row(label, flat.length > 120 ? flat.slice(0, 120) + '…' : flat)
  }

  const connRows = [
    row('IP 类型', net.version),
    row('HTTP 协议', net.httpProtocol),
    row('TLS 版本', net.tls),
    row('TLS 加密套件', net.cipher),
    row('客户端端口', net.tcpPort),
    row('连接复用', net.keepAlive),
    row('请求优先级', net.priority),
    row('Accept-Language', net.acceptLanguage),
    hdr('sec-ch-ua', 'Sec-CH-UA'),
    hdr('accept-encoding', 'Accept-Encoding'),
    hdr('referer', '来源页'),
    row('CF-Ray', net.cfRay),
    row('大洲', net.continent),
    row('省份 / 州', net.region),
    row('邮政编码', net.postal),
    row('经纬度', net.lat && net.lon ? net.lat + ', ' + net.lon : ''),
    row('识别运营商', net.isp),
    row('接入节点', net.colo),
  ].join('')

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>IP 地址查询</title>
<style nonce="${nonce}">
  :root {
    color-scheme: light;
    --bg: #f3f5fb;
    --panel: rgba(255,255,255,.78);
    --panel-solid: #ffffff;
    --line: rgba(15,23,42,.08);
    --line-strong: rgba(15,23,42,.12);
    --text: #0f172a;
    --muted: #667085;
    --faint: #98a2b3;
    --accent: #4f46e5;
    --accent-2: #0ea5e9;
    --soft: #eef2ff;
    --ok: #12b76a;
    --shadow: 0 24px 70px -24px rgba(15,23,42,.28), 0 2px 8px rgba(15,23,42,.04);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --bg: #070b14;
      --panel: rgba(15,23,42,.62);
      --panel-solid: #0d1424;
      --line: rgba(148,163,184,.14);
      --line-strong: rgba(148,163,184,.22);
      --text: #e8eefb;
      --muted: #94a3b8;
      --faint: #64748b;
      --accent: #8ba3ff;
      --accent-2: #38bdf8;
      --soft: rgba(99,102,241,.14);
      --ok: #34d399;
      --shadow: 0 30px 80px -30px rgba(0,0,0,.8), 0 2px 8px rgba(0,0,0,.24);
    }
  }
  * { box-sizing: border-box; }
  html, body { min-height: 100%; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 15px;
    line-height: 1.6;
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    overflow-x: hidden;
  }
  .backdrop { position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
  .backdrop::before {
    content: "";
    position: absolute; inset: 0;
    background-image:
      linear-gradient(rgba(15,23,42,.045) 1px, transparent 1px),
      linear-gradient(90deg, rgba(15,23,42,.045) 1px, transparent 1px);
    background-size: 44px 44px;
    mask-image: radial-gradient(ellipse 80% 60% at 50% 35%, #000 20%, transparent 78%);
  }
  .backdrop .orb { position: absolute; border-radius: 999px; filter: blur(70px); opacity: .55; }
  .orb-a { width: 440px; height: 440px; left: -120px; top: -140px; background: rgba(99,102,241,.25); }
  .orb-b { width: 380px; height: 380px; right: -100px; top: 20%; background: rgba(14,165,233,.18); }
  .orb-c { width: 340px; height: 340px; left: 30%; bottom: -160px; background: rgba(16,185,129,.12); }
  @media (prefers-color-scheme: dark) {
    .backdrop::before {
      background-image:
        linear-gradient(rgba(148,163,184,.06) 1px, transparent 1px),
        linear-gradient(90deg, rgba(148,163,184,.06) 1px, transparent 1px);
    }
  }
  .topbar {
    position: relative; z-index: 1;
    display: flex; align-items: center; justify-content: space-between;
    padding: 26px 32px;
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand-mark { width: 30px; height: 30px; }
  .brand-name { font-weight: 650; letter-spacing: -.01em; font-size: 15px; }
  .brand-tag { color: var(--faint); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; margin-left: 8px; }
  .top-status { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); font-size: 12px; }
  .pulse { position: relative; width: 7px; height: 7px; border-radius: 50%; background: var(--ok); }
  .pulse::after {
    content: ""; position: absolute; inset: -4px; border-radius: 50%;
    border: 1px solid var(--ok); opacity: .45; animation: pulse 2.4s ease-out infinite;
  }
  @keyframes pulse { 0% { transform: scale(.55); opacity: .55; } 80%,100% { transform: scale(1.3); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .pulse::after { animation: none; } }
  main { position: relative; z-index: 1; flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px 20px 48px; }
  .card {
    width: 100%; max-width: 570px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 24px;
    box-shadow: var(--shadow);
    backdrop-filter: blur(22px) saturate(140%);
    -webkit-backdrop-filter: blur(22px) saturate(140%);
    padding: 34px 36px 30px;
    position: relative;
    overflow: hidden;
  }
  .card::before {
    content: ""; position: absolute; inset: 0 0 auto 0; height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.7), transparent);
    opacity: .8;
  }
  @media (prefers-color-scheme: dark) { .card::before { background: linear-gradient(90deg, transparent, rgba(255,255,255,.22), transparent); } }
  .eyebrow {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 11px; font-weight: 650; letter-spacing: .14em; text-transform: uppercase;
    color: var(--accent); margin-bottom: 22px;
  }
  .eyebrow .line { width: 22px; height: 1px; background: currentColor; opacity: .45; }
  .ip-label { font-size: 13px; color: var(--muted); margin: 0 0 8px; letter-spacing: .02em; }
  .ip {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: clamp(26px, 7vw, 38px);
    font-weight: 650; letter-spacing: -.035em; line-height: 1.15;
    word-break: break-all; margin: 0 0 10px;
    background: linear-gradient(96deg, var(--text) 20%, var(--accent) 120%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .ip-meta { display: flex; align-items: center; gap: 10px; color: var(--faint); font-size: 12px; margin-bottom: 14px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; background: var(--soft); color: var(--accent); font-weight: 600; font-size: 11px; letter-spacing: .02em; }
  .grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 1px;
    background: var(--line); border: 1px solid var(--line); border-radius: 16px; overflow: hidden;
  }
  .info { background: var(--panel-solid); padding: 16px 18px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .info-label { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; }
  .info-label svg { width: 13px; height: 13px; opacity: .8; }
  .info-value { font-weight: 600; font-size: 14px; letter-spacing: -.01em; overflow-wrap: anywhere; }
  .info.span-2 { grid-column: span 2; }
  .ua { margin-top: 18px; padding: 13px 16px; border-radius: 12px; border: 1px solid var(--line); background: color-mix(in srgb, var(--panel-solid) 70%, transparent); }
  .ua-label { font-size: 11px; font-weight: 600; letter-spacing: .10em; text-transform: uppercase; color: var(--faint); margin-bottom: 4px; }
  .ua-text { font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
  .card-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--faint); font-size: 12px; }
  .card-foot .ok { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 14%, transparent); }
  footer { position: relative; z-index: 1; text-align: center; padding: 0 20px 28px; color: var(--faint); font-size: 11.5px; letter-spacing: .03em; }
  .stack { position: relative; z-index: 1; width: 100%; max-width: 570px; display: flex; flex-direction: column; gap: 14px; }
  .top-status { gap: 12px; }
  .clock { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .tabs {
    display: flex; gap: 3px; padding: 4px;
    border: 1px solid var(--line); border-radius: 15px; background: var(--panel);
    backdrop-filter: blur(18px) saturate(140%); -webkit-backdrop-filter: blur(18px) saturate(140%);
  }
  .tab {
    flex: 1; padding: 8px 6px; border: 0; border-radius: 11px; background: transparent;
    color: var(--muted); font: inherit; font-size: 12.5px; font-weight: 600; letter-spacing: .01em;
    cursor: pointer; transition: background .18s ease, color .18s ease;
  }
  .tab:hover { color: var(--text); }
  .tab.is-on { background: var(--soft); color: var(--accent); }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
  .card-head h2 { margin: 0; font-size: 15px; font-weight: 650; letter-spacing: -.01em; }
  .ghost-btn {
    display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px;
    border: 1px solid var(--line-strong); border-radius: 9px; background: transparent;
    color: var(--muted); font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer;
  }
  .ghost-btn:hover { color: var(--text); border-color: var(--accent); }
  .rows { margin: 0; border: 1px solid var(--line); border-radius: 15px; overflow: hidden; background: var(--panel-solid); }
  .row { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; padding: 11px 15px; border-bottom: 1px solid var(--line); }
  .row:last-child { border-bottom: 0; }
  .row dt { color: var(--muted); font-size: 12.5px; white-space: nowrap; }
  .row dd { margin: 0; font-size: 13px; font-weight: 600; text-align: right; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
  .rows-note { margin: 10px 2px 0; color: var(--faint); font-size: 11.5px; }
  .ip-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 26px; }
  .card[hidden], .panel-block[hidden] { display: none; }
  .sub-head { margin: 20px 0 9px; font-size: 11px; font-weight: 650; letter-spacing: .12em; text-transform: uppercase; color: var(--faint); }
  .tool + .tool { margin-top: 12px; }
  .tool { display: flex; flex-direction: column; gap: 10px; padding: 15px 16px; border: 1px solid var(--line); border-radius: 16px; background: var(--panel-solid); }
  .tool h3 { margin: 0; font-size: 13px; font-weight: 650; }
  .tool-desc { margin: 0; color: var(--faint); font-size: 11.5px; }
  .tool-row { display: flex; gap: 8px; }
  .field {
    flex: 1; min-width: 0; padding: 9px 12px; border: 1px solid var(--line-strong); border-radius: 10px;
    background: var(--bg); color: var(--text); font: inherit; font-size: 13px;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  .field:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
  .out {
    margin: 0; padding: 11px 13px; border-radius: 10px; background: var(--soft);
    color: var(--text); font-size: 12px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  .out.is-empty { background: transparent; border: 1px dashed var(--line-strong); color: var(--faint); }
  .out.is-error { background: color-mix(in srgb, #ef4444 12%, transparent); color: #b91c1c; }
  @media (prefers-color-scheme: dark) { .out.is-error { color: #fca5a5; } }
  @media (prefers-reduced-motion: reduce) { .tab { transition: none; } }
  @media (max-width: 540px) {
    .topbar { padding: 20px; }
    .brand-tag { display: none; }
    .card { padding: 26px 22px 24px; border-radius: 20px; }
    .grid { grid-template-columns: 1fr; }
    .info.span-2 { grid-column: auto; }
    .card-foot { flex-direction: column; align-items: flex-start; gap: 8px; }
    .top-status .status-label { display: none; }
    .tab { padding: 8px 4px; font-size: 12px; }
    .card-head { flex-direction: column; align-items: flex-start; gap: 10px; }
  }
</style>
</head>
<body>
<div class="backdrop" aria-hidden="true">
  <div class="orb orb-a"></div>
  <div class="orb orb-b"></div>
  <div class="orb orb-c"></div>
</div>
<header class="topbar">
  <div class="brand">
    <svg class="brand-mark" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="38" height="38" rx="11" fill="currentColor" opacity=".07"/>
      <rect x="1" y="1" width="38" height="38" rx="11" stroke="currentColor" stroke-opacity=".12"/>
      <path d="M12 25.5 20 12l8 13.5-8 4.6-8-4.6Z" stroke="var(--accent)" stroke-width="1.7" stroke-linejoin="round"/>
      <circle cx="20" cy="12" r="2.2" fill="var(--accent)"/>
      <circle cx="12" cy="25.5" r="2.2" fill="var(--accent)" opacity=".7"/>
      <circle cx="28" cy="25.5" r="2.2" fill="var(--accent)" opacity=".7"/>
    </svg>
    <span class="brand-name">Transit Hub</span>
    <span class="brand-tag">Edge Network</span>
  </div>
  <div class="top-status"><span class="pulse"></span><span class="status-label">节点运行中</span><span class="clock" id="clock">--:--:--</span></div>
</header>
<main>
<div class="stack">
  <nav class="tabs" role="tablist" aria-label="诊断信息分类">
    <button class="tab is-on" type="button" role="tab" data-tab="overview" aria-selected="true" aria-controls="panel-overview">概览</button>
    <button class="tab" type="button" role="tab" data-tab="conn" aria-selected="false" aria-controls="panel-conn" tabindex="-1">连接</button>
    <button class="tab" type="button" role="tab" data-tab="browser" aria-selected="false" aria-controls="panel-browser" tabindex="-1">浏览器</button>
    <button class="tab" type="button" role="tab" data-tab="tools" aria-selected="false" aria-controls="panel-tools" tabindex="-1">工具</button>
  </nav>
  <section class="card" id="panel-overview" role="tabpanel" aria-labelledby="ip-title">
    <div class="eyebrow"><span class="line"></span>Network Diagnostics</div>
    <p class="ip-label" id="ip-title">您的公网 IP 地址</p>
    <div class="ip" id="ip-line" data-copy="公网 IP">${esc(ip)}</div>
    <div class="ip-meta"><span class="chip">${version}</span><span>由 Cloudflare 边缘网络识别</span></div>
    <div class="ip-actions">
      <button class="ghost-btn" type="button" id="ip-mask"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4l16 16"/><path d="M9.9 5.2A9.8 9.8 0 0 1 12 5c6 0 9.5 7 9.5 7a17.7 17.7 0 0 1-3.3 4.1M6.1 6.6A17.5 17.5 0 0 0 2.5 12S6 19 12 19a9.7 9.7 0 0 0 4.2-.9"/></svg><span id="ip-mask-label">打码显示</span></button>
      <button class="ghost-btn" type="button" id="ip-copy"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15.5 9V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5H9"/></svg><span id="ip-copy-label">复制 IP</span></button>
      <button class="ghost-btn" type="button" id="reload"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 11a8 8 0 0 0-14-4.5L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4.5L20 15M20 20v-5h-5"/></svg><span>重新识别</span></button>
    </div>
    <div class="grid">
      <div class="info">
        <span class="info-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/></svg>
          地理位置
        </span>
        <span class="info-value" data-copy="地理位置">${esc(location)}</span>
      </div>
      <div class="info">
        <span class="info-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.6 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.6-3.8-9S9.5 5.5 12 3Z"/></svg>
          接入节点
        </span>
        <span class="info-value" data-copy="接入节点">${esc(colo)}</span>
      </div>
      <div class="info span-2">
        <span class="info-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M3.5 9.5h17M8 14.5h5"/></svg>
          运营商
        </span>
        <span class="info-value" data-copy="运营商">${esc(isp)}</span>
      </div>
      <div class="info">
        <span class="info-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>
          所在时区
        </span>
        <span class="info-value" data-copy="所在时区">${esc(or(cf.timezone, '未知'))}</span>
      </div>
      <div class="info">
        <span class="info-label">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 18V9M9.5 18V4M15 18v-7M20.5 18v-11"/></svg>
          自治系统
        </span>
        <span class="info-value" data-copy="自治系统">${esc(or(cf.asn, '未知'))}</span>
      </div>
    </div>
    <div class="ua">
      <div class="ua-label">浏览器信息</div>
      <div class="ua-text" data-copy="浏览器 UA">${esc(uaShort)}</div>
    </div>
    <div class="card-foot">
      <span class="ok"><span class="dot"></span>服务运行正常</span>
      <button class="ghost-btn" type="button" id="copy-page"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15.5 9V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5H9"/></svg><span id="copy-page-label">复制本页信息</span></button>
    </div>
  </section>
  <section class="card" id="panel-conn" role="tabpanel" aria-labelledby="conn-title" hidden>
    <div class="card-head"><h2 id="conn-title">本次连接</h2></div>
    <dl class="rows">${connRows}</dl>
    <p class="rows-note">以上信息由 Cloudflare 边缘节点从本次请求中识别，服务端不保存任何访问记录。</p>
  </section>
  <section class="card" id="panel-browser" role="tabpanel" aria-labelledby="browser-title" hidden>
    <div class="card-head"><h2 id="browser-title">浏览器环境</h2></div>
    <dl class="rows" id="env-rows"></dl>
    <div class="sub-head" id="perf-head">网络与加载计时</div>
    <dl class="rows" id="perf-rows"></dl>
    <p class="rows-note">本标签页的数据由浏览器本地读取，不会发送到服务器。</p>
  </section>
  <section class="card" id="panel-tools" role="tabpanel" aria-labelledby="tools-title" hidden>
    <div class="card-head"><h2 id="tools-title">本地小工具</h2></div>
    <div class="tool">
      <h3>IP 进制互转</h3>
      <p class="tool-desc">输入 IPv4 点分十进制，或对应的 32 位整数。</p>
      <div class="tool-row"><input class="field" id="ipconv" type="text" aria-label="IP 地址或整数" autocomplete="off" spellcheck="false" placeholder="例如 8.8.8.8 或 134744072"></div>
      <pre class="out is-empty" id="ipconv-out">等待输入</pre>
    </div>
    <div class="tool">
      <h3>CIDR 网段计算</h3>
      <p class="tool-desc">输入地址与前缀长度，例如 192.168.10.0/24。</p>
      <div class="tool-row"><input class="field" id="cidr" type="text" aria-label="CIDR 网段" autocomplete="off" spellcheck="false" placeholder="例如 192.168.10.0/24"></div>
      <pre class="out is-empty" id="cidr-out">等待输入</pre>
    </div>
    <div class="tool">
      <h3>时间戳与日期互转</h3>
      <p class="tool-desc">输入秒级或毫秒级时间戳，也可输入日期时间文本。</p>
      <div class="tool-row"><input class="field" id="ts" type="text" aria-label="时间戳或日期" autocomplete="off" spellcheck="false" placeholder="例如 1735689600 或 2026-01-01 08:00"></div>
      <pre class="out is-empty" id="ts-out">等待输入</pre>
    </div>
    <p class="rows-note">三项计算全部在你的浏览器本地完成，输入内容不会离开这台设备。</p>
  </section>
</div>
</main>
<footer>© ${new Date().getFullYear()} Transit Hub · Network Diagnostics</footer>
<script nonce="${nonce}">
(function () {
  var NL = String.fromCharCode(10);
  var EMPTY = '等待输入';

  function node(id) { return document.getElementById(id); }
  function setText(id, value) { var n = node(id); if (n) n.textContent = value; }
  function on(id, fn) { var n = node(id); if (n) n.addEventListener('click', fn); }
  function pad(value) { var x = String(value); return x.length < 2 ? '0' + x : x; }

  var flashTimers = {};
  function flash(id, label) {
    var n = node(id);
    if (!n) return;
    if (!n.getAttribute('data-label')) n.setAttribute('data-label', n.textContent);
    n.textContent = label;
    if (flashTimers[id]) window.clearTimeout(flashTimers[id]);
    flashTimers[id] = window.setTimeout(function () {
      n.textContent = n.getAttribute('data-label');
    }, 1600);
  }

  /* ---------- 复制 ---------- */
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-2400px';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }
  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(legacyCopy(text)); });
    } else {
      done(legacyCopy(text));
    }
  }

  /* ---------- 标签页 ---------- */
  var tabs = [];
  var tabEls = document.querySelectorAll('.tab');
  for (var i = 0; i < tabEls.length; i++) tabs.push(tabEls[i]);
  var envFilled = false;

  function activate(key, focus) {
    for (var t = 0; t < tabs.length; t++) {
      var isOn = tabs[t].getAttribute('data-tab') === key;
      tabs[t].classList.toggle('is-on', isOn);
      tabs[t].setAttribute('aria-selected', isOn ? 'true' : 'false');
      tabs[t].tabIndex = isOn ? 0 : -1;
      if (isOn && focus) tabs[t].focus();
    }
    var panels = document.querySelectorAll('[role="tabpanel"]');
    for (var p = 0; p < panels.length; p++) panels[p].hidden = panels[p].id !== 'panel-' + key;
    if (key === 'browser' && !envFilled) {
      envFilled = true;
      fillEnv();
    }
  }

  for (var b = 0; b < tabs.length; b++) {
    (function (tab, index) {
      tab.addEventListener('click', function () { activate(tab.getAttribute('data-tab'), false); });
      tab.addEventListener('keydown', function (ev) {
        var step = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
        if (step) {
          ev.preventDefault();
          activate(tabs[(index + step + tabs.length) % tabs.length].getAttribute('data-tab'), true);
        } else if (ev.key === 'Home' || ev.key === 'End') {
          ev.preventDefault();
          activate(tabs[ev.key === 'End' ? tabs.length - 1 : 0].getAttribute('data-tab'), true);
        }
      });
    })(tabs[b], b);
  }

  /* ---------- 时钟 ---------- */
  var clock = node('clock');
  function tick() {
    if (!clock) return;
    var d = new Date();
    clock.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  tick();
  window.setInterval(tick, 1000);

  /* ---------- IP 打码与复制 ---------- */
  var ipLine = node('ip-line');
  var realIp = ipLine ? String(ipLine.textContent).trim() : '';
  var masked = false;

  function maskIp(value) {
    if (!value || value === '未知') return value;
    if (value.indexOf(':') >= 0) {
      var g = value.split(':');
      return g.slice(0, 2).join(':') + ':…';
    }
    var parts = value.split('.');
    if (parts.length !== 4) return value;
    return parts[0] + '.' + parts[1] + '.*.*';
  }

  on('ip-mask', function () {
    if (!ipLine) return;
    masked = !masked;
    ipLine.textContent = masked ? maskIp(realIp) : realIp;
    setText('ip-mask-label', masked ? '显示完整' : '打码显示');
  });
  on('ip-copy', function () {
    if (!realIp || realIp === '未知') {
      flash('ip-copy-label', '暂无 IP');
      return;
    }
    copyText(realIp, function (ok) { flash('ip-copy-label', ok ? '已复制' : '复制失败'); });
  });
  on('reload', function () { window.location.reload(); });
  on('copy-page', function () {
    var items = document.querySelectorAll('[data-copy]');
    var lines = [];
    for (var c = 0; c < items.length; c++) {
      var value = String(items[c].textContent).trim();
      if (value && value !== '未知') lines.push(items[c].getAttribute('data-copy') + '  ' + value);
    }
    if (!lines.length) {
      flash('copy-page-label', '暂无内容');
      return;
    }
    copyText('Transit Hub 诊断信息' + NL + lines.join(NL), function (ok) {
      flash('copy-page-label', ok ? '已复制' : '复制失败');
    });
  });

  /* ---------- 浏览器环境 ---------- */
  function addRow(dl, label, value) {
    var text = value === undefined || value === null ? '' : String(value).trim();
    if (!text) return;
    var wrap = document.createElement('div');
    wrap.className = 'row';
    var dt = document.createElement('dt');
    dt.textContent = label;
    var dd = document.createElement('dd');
    dd.textContent = text;
    dd.setAttribute('data-copy', label);
    wrap.appendChild(dt);
    wrap.appendChild(dd);
    dl.appendChild(wrap);
  }
  function mq(query) { return window.matchMedia ? window.matchMedia(query).matches : false; }
  function brandText(brands) {
    var out = [];
    for (var r = 0; r < brands.length; r++) out.push(brands[r].brand + ' ' + brands[r].version);
    return out.join(', ');
  }
  function offsetText() {
    var minutes = -new Date().getTimezoneOffset();
    var abs = Math.abs(minutes);
    return (minutes < 0 ? '-' : '+') + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
  }

  function fillEnv() {
    var env = node('env-rows');
    if (!env) return;
    var n = navigator;
    var timeZone = '';
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (err) {
      timeZone = '';
    }
    var hints = n.userAgentData || null;
    addRow(env, '平台', (hints && hints.platform) || n.platform || '');
    addRow(env, '浏览器内核', hints && hints.brands && hints.brands.length ? brandText(hints.brands) : '');
    addRow(env, '移动设备', hints ? (hints.mobile ? '是' : '否') : '');
    addRow(env, 'CPU 核心', n.hardwareConcurrency || '');
    addRow(env, '内存', n.deviceMemory ? n.deviceMemory + ' GB' : '');
    addRow(env, '界面语言', n.languages && n.languages.length ? n.languages.join(', ') : n.language || '');
    addRow(env, '时区', timeZone ? timeZone + ' (UTC' + offsetText() + ')' : '');
    addRow(env, '屏幕', window.screen ? screen.width + ' × ' + screen.height : '');
    addRow(env, '可用区域', window.screen ? screen.availWidth + ' × ' + screen.availHeight : '');
    addRow(env, '视口', window.innerWidth + ' × ' + window.innerHeight);
    addRow(env, '像素比', window.devicePixelRatio ? window.devicePixelRatio + 'x' : '');
    addRow(env, '色深', window.screen && screen.colorDepth ? screen.colorDepth + ' bit' : '');
    addRow(env, '触摸点', typeof n.maxTouchPoints === 'number' ? n.maxTouchPoints : '');
    addRow(env, '在线状态', n.onLine ? '在线' : '离线');
    addRow(env, 'Cookie', n.cookieEnabled ? '已启用' : '已禁用');
    addRow(env, '外观偏好', mq('(prefers-color-scheme: dark)') ? '深色' : '浅色');
    addRow(env, '减少动效', mq('(prefers-reduced-motion: reduce)') ? '已开启' : '未开启');
    addRow(env, '网络类型', n.connection && n.connection.effectiveType ? n.connection.effectiveType : '');
    addRow(env, '来源页', document.referrer || '');
    fillPerf();
  }

  function fillPerf() {
    var dl = node('perf-rows');
    if (!dl) return;
    var list = window.performance && performance.getEntriesByType ? performance.getEntriesByType('navigation') : [];
    var nav = list.length ? list[0] : null;
    if (nav) {
      var ms = function (value) { return value > 0 && isFinite(value) ? Math.round(value) + ' ms' : ''; };
      addRow(dl, 'DNS 解析', ms(nav.domainLookupEnd - nav.domainLookupStart));
      addRow(dl, 'TCP 连接', ms(nav.connectEnd - nav.connectStart));
      addRow(dl, 'TLS 握手', nav.secureConnectionStart ? ms(nav.connectEnd - nav.secureConnectionStart) : '');
      addRow(dl, '等待首字节', ms(nav.responseStart - nav.requestStart));
      addRow(dl, '内容下载', ms(nav.responseEnd - nav.responseStart));
      addRow(dl, 'DOM 就绪', ms(nav.domContentLoadedEventEnd));
      addRow(dl, '完全加载', ms(nav.duration));
      addRow(dl, 'HTTP 协议', nav.protocol || '');
    }
    if (!dl.children.length) {
      dl.hidden = true;
      var head = node('perf-head');
      if (head) head.hidden = true;
    }
  }

  /* ---------- 小工具 ---------- */
  function setOut(id, state, content) {
    var n = node(id);
    if (!n) return;
    n.textContent = content;
    n.classList.toggle('is-empty', state === 'empty');
    n.classList.toggle('is-error', state === 'error');
  }
  function isDigits(text) {
    if (!text.length) return false;
    for (var d = 0; d < text.length; d++) {
      var code = text.charCodeAt(d);
      if (code < 48 || code > 57) return false;
    }
    return true;
  }
  function parseV4(text) {
    var parts = text.split('.');
    if (parts.length !== 4) return null;
    var out = [];
    for (var o = 0; o < 4; o++) {
      if (!isDigits(parts[o]) || parts[o].length > 3) return null;
      var value = parseInt(parts[o], 10);
      if (value > 255) return null;
      out.push(value);
    }
    return out;
  }
  function toLong(octets) { return ((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]; }
  function toOctets(long) {
    var out = [];
    for (var s = 3; s >= 0; s--) out.push(Math.floor(long / Math.pow(256, s)) % 256);
    return out;
  }
  function ipOf(long) { return toOctets(long).join('.'); }
  function bin8(value) { var s = value.toString(2); while (s.length < 8) s = '0' + s; return s; }
  function hex2(value) { var s = value.toString(16); return s.length < 2 ? '0' + s : s; }

  function runConv(raw) {
    var text = raw.trim();
    if (!text) return setOut('ipconv-out', 'empty', EMPTY);
    if (text.indexOf(':') >= 0) return setOut('ipconv-out', 'error', '仅换算 IPv4，请输入点分十进制或 32 位整数');
    var octets = text.indexOf('.') >= 0 ? parseV4(text) : null;
    var origin = 'IPv4 地址';
    var long = 0;
    if (!octets && isDigits(text) && text.length <= 10) {
      long = parseInt(text, 10);
      if (long > 4294967295) return setOut('ipconv-out', 'error', '十进制超出 IPv4 范围（0 – 4294967295）');
      octets = toOctets(long);
      origin = '十进制整数';
    }
    if (!octets) return setOut('ipconv-out', 'error', '格式不正确，示例：8.8.8.8 或 134744072');
    long = toLong(octets);
    setOut('ipconv-out', 'ok', [
      '识别为      ' + origin,
      '点分十进制  ' + octets.join('.'),
      '十进制      ' + long,
      '十六进制    0x' + octets.map(hex2).join(''),
      '二进制      ' + octets.map(bin8).join('.'),
      'IPv6 映射   ::ffff:' + octets.join('.'),
    ].join(NL));
  }

  function runCidr(raw) {
    var text = raw.trim();
    if (!text) return setOut('cidr-out', 'empty', EMPTY);
    var parts = text.split('/');
    if (parts.length !== 2) return setOut('cidr-out', 'error', '格式：地址/前缀，例如 192.168.10.0/24');
    var octets = parseV4(parts[0].trim());
    if (!octets) return setOut('cidr-out', 'error', '仅支持 IPv4 地址，例如 192.168.10.0/24');
    if (!isDigits(parts[1]) || parts[1].length > 2) return setOut('cidr-out', 'error', '前缀长度需为 0 – 32');
    var prefix = parseInt(parts[1], 10);
    if (prefix > 32) return setOut('cidr-out', 'error', '前缀长度需为 0 – 32');
    var size = Math.pow(2, 32 - prefix);
    var network = Math.floor(toLong(octets) / size) * size;
    var broadcast = network + size - 1;
    var mask = prefix === 0 ? 0 : 4294967296 - size;
    setOut('cidr-out', 'ok', [
      'CIDR 表示   ' + ipOf(network) + '/' + prefix,
      '网络地址    ' + ipOf(network),
      '子网掩码    ' + ipOf(mask),
      '通配符掩码  ' + ipOf(size - 1),
      '广播地址    ' + ipOf(broadcast),
      '地址总数    ' + size,
      '可用主机    ' + (prefix >= 31 ? (prefix === 32 ? 1 : 2) : size - 2),
      '首个可用    ' + (prefix <= 30 ? ipOf(network + 1) : ipOf(network)),
      '末个可用    ' + (prefix <= 30 ? ipOf(broadcast - 1) : ipOf(broadcast)),
    ].join(NL));
  }

  function textToDate(text) {
    var groups = text.split(' ');
    var ymd = groups[0].split('-');
    if (ymd.length !== 3) ymd = groups[0].split('/');
    if (ymd.length !== 3 || !isDigits(ymd[0]) || !isDigits(ymd[1]) || !isDigits(ymd[2])) return null;
    var hms = [0, 0, 0];
    if (groups[1]) {
      var pieces = groups[1].split(':');
      for (var h = 0; h < pieces.length && h < 3; h++) {
        if (!isDigits(pieces[h])) return null;
        hms[h] = parseInt(pieces[h], 10);
      }
    }
    var date = new Date(parseInt(ymd[0], 10), parseInt(ymd[1], 10) - 1, parseInt(ymd[2], 10), hms[0], hms[1], hms[2]);
    return isNaN(date.getTime()) ? null : date.getTime();
  }
  function humanDiff(delta) {
    var units = [[31536000, '年'], [2592000, '个月'], [86400, '天'], [3600, '小时'], [60, '分钟']];
    var rest = Math.abs(delta) / 1000;
    var parts = [];
    for (var u = 0; u < units.length; u++) {
      var count = Math.floor(rest / units[u][0]);
      if (count) {
        parts.push(count + units[u][1]);
        rest -= count * units[u][0];
      }
      if (parts.length === 2) break;
    }
    if (!parts.length) parts.push('不到 1 分钟');
    return parts.join(' ') + (delta > 0 ? '前' : '后');
  }
  function runStamp(raw) {
    var text = raw.trim();
    if (!text) return setOut('ts-out', 'empty', EMPTY);
    var digits = text.charAt(0) === '-' ? text.slice(1) : text;
    var milliseconds = null;
    if (isDigits(digits)) {
      var numeric = Number(text);
      if (Math.abs(numeric) > 86400000000000) return setOut('ts-out', 'error', '时间戳超出可处理范围');
      milliseconds = digits.length > 10 ? numeric : numeric * 1000;
    } else {
      var parsed = Date.parse(text);
      milliseconds = isNaN(parsed) ? textToDate(text) : parsed;
      if (milliseconds === null || isNaN(milliseconds)) {
        return setOut('ts-out', 'error', '无法识别，示例：1735689600 或 2026-01-01 08:00');
      }
    }
    var date = new Date(milliseconds);
    if (isNaN(date.getTime())) return setOut('ts-out', 'error', '时间超出可处理范围');
    var weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
    var local = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
    setOut('ts-out', 'ok', [
      '秒级        ' + Math.round(milliseconds / 1000),
      '毫秒级      ' + Math.round(milliseconds),
      'UTC         ' + date.toISOString().replace('T', ' ').slice(0, 19),
      '本地时间    ' + local + ' ' + weekday,
      '相对当前    ' + humanDiff(Date.now() - milliseconds),
    ].join(NL));
  }

  function bindTool(id, fn) {
    var n = node(id);
    if (n) n.addEventListener('input', function () { fn(n.value); });
  }
  bindTool('ipconv', runConv);
  bindTool('cidr', runCidr);
  bindTool('ts', runStamp);
})();
</script>
</body>
</html>`

  return new Response(pageBody(headOnly, html), {
    headers: {
      ...htmlHeaders(),
      'content-type': 'text/html;charset=UTF-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'content-security-policy': decoyCsp(nonce),
    },
  })
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]))
}
