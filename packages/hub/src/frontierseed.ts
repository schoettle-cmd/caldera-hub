/** The Frontier's first lands (Mike 11-17: "about 200 famous GitHubs"): well-known people on GitHub, added by Caldera from
 *  public data only. Nobody on this list is contacted. Organizations, missing accounts and blocked names are skipped. */
export const FRONTIER_SEED: string[] = `
torvalds gaearon yyx990803 sindresorhus tj addyosmani paulirish kentcdodds getify mojombo defunkt pjhyett wycats dhh antirez
rauchg jeresig mrdoob fabpot taylorotwell karpathy gvanrossum mitsuhiko kennethreitz fchollet jakevdp wesm rasbt ry
substack isaacs mikeal domenic feross mafintosh mxstbr acdlite sebmarkbage sophiebits zpao jordwalke chenglou vjeux
Rich-Harris developit lukeed egoist sebastianbenz addyosmani jaffathecake surma kdy1 evanw  shuding leerob
timneutkens pacocoursey jamiebuilds kriskowal ljharb bnoordhuis indutny piscisaureus trevnorris jasnell mcollina
 ruanyf yinwang0 phodal daimajia JakeWharton  chrisbanes romainguy gabrielemariotti
hadley jennybc yihui jtleek juliasilge dgrtwo minimaxir jph00 sgugger thomwolf julien-c lhoestq clefourrier
simonw mattt soffes steipete krzysztofzablocki onevcat kylef twostraws mxcl 
bradfitz rsc robpike griesemer ianlancetaylor davecheney spf13 mitchellh armon fatih tpope junegunn
jessfraz brendandburns thockin kelseyhightower jbeda crosbymichael shykes 
dtolnay BurntSushi alexcrichton nikomatsakis steveklabnik withoutboats matklad seanmonstar carllerche
jonhoo fasterthanlime ThePrimeagen tsoding jdan bkaradzic ocornut floooh rxi
  nothings Gargron
 nat holman kneath technoweenie atmos rtomayko jnunemaker schacon peff gitster
 posva antfu patak-dev sapphi-red privatenumber tannerlinsley TkDodo KyleAMathews jaredpalmer
shadcn steven-tey t3dotgg  gr2m JoshuaKGoldberg orta DanielRosenwasser ahejlsberg RyanCavanaugh
sandersn weswigham jakebailey andrewbranch iamakulov wojtekmaj necolas trueadm acemarke markerikson
 hakimel  LeaVerou chriscoyier una argyleink bramus jensimmons rachelandrew csswizardry
holman sahat eddiezane cassidoo bdougie wesbos stolinski ahmadawais jlengstorf  sdras
yoshuawuyts juliangruber dominictarr maxogden mafintosh chrisdickinson hughsk mattdesl 
mbostock jasondavies vasturiano Fil curran tmcw  mourner
geohot ggerganov abetlen jmorganca  lucidrains hwchase17 jxnl yoheinakajima 
borisdayma AK391 osanseviero patrickvonplaten younesbelkada ArthurZucker
chrislgarry  trekhleb jwasham kamranahmedse vinta donnemartin sdmg15 ripienaar
avelino  josevalim chrismccord sasa1977 wojtekmach  tenderlove jeremyevans
matz ko1 headius enebo byroot eileencodes rafaelfranca jeremy
`.split(/\s+/).filter(Boolean).filter((v, i, a) => a.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i);
