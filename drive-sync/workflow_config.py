from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class WorkflowWatch:
    slug: str
    name: str
    folder_id: str
    category: str
    year: str
    month: str | None


WATCHES = [
    WorkflowWatch("januar-2026-eingang", "Januar 2026 - Eingang", "1e70yv85tz_0DHvPm5de4_y71RWZJ-dk6", "eingang", "2026", "01"),
    WorkflowWatch("februar-2026-eingang", "Februar 2026 - Eingang", "1QJN4WyMrgWhTmd6OABYdAka1e4KNdWBx", "eingang", "2026", "02"),
    WorkflowWatch("maerz-2026-eingang", "März 2026 - Eingang", "15MTM11rqK3aWaL4YCDtMHXaTwEchrn4V", "eingang", "2026", "03"),
    WorkflowWatch("april-2026-eingang", "April 2026 - Eingang", "1hrCPg_Wq0vjK_9nhTdk8BpK_Oc3INROz", "eingang", "2026", "04"),
    WorkflowWatch("mai-2026-eingang", "Mai 2026 - Eingang", "1OS5NnJZi3D94FGhDcNMYdJFfc5RKzrkw", "eingang", "2026", "05"),
    WorkflowWatch("juni-2026-eingang", "Juni 2026 - Eingang", "1nXJzvXOLNs-XooOzpxgfQD6pzCRdsqDk", "eingang", "2026", "06"),
    WorkflowWatch("juli-2026-eingang", "Juli 2026 - Eingang", "1NxJ1mYHl2YK3Xhe1coedhBEDvQR_Z_wt", "eingang", "2026", "07"),
    WorkflowWatch("august-2026-eingang", "August 2026 - Eingang", "1bbAv_x3pUWCCVahr2uiBw87d5jDuFaNw", "eingang", "2026", "08"),
    WorkflowWatch("september-2026-eingang", "September 2026 - Eingang", "1xsOnrBAMA7-2w-iEv09fV_yf4ZZAVBmI", "eingang", "2026", "09"),
    WorkflowWatch("oktober-2026-eingang", "Oktober 2026 - Eingang", "15unDnb2tKqFVciG8Ip-chSA2hG0xVK0r", "eingang", "2026", "10"),
    WorkflowWatch("november-2026-eingang", "November 2026 - Eingang", "1VO63gY6dU7Sx6MbW7_M5dA_fUGhmbm7A", "eingang", "2026", "11"),
    WorkflowWatch("dezember-2026-eingang", "Dezember 2026 - Eingang", "1dPafHTJVpa_eq2OWLOKrgMLb_pG_6DiA", "eingang", "2026", "12"),
    WorkflowWatch("januar-2026-ausgang", "Januar 2026 - Ausgang", "1L1bPL7Wwhl6Loz4JgnJHfpYksx2EdWxd", "ausgang", "2026", "01"),
    WorkflowWatch("februar-2026-ausgang", "Februar 2026 - Ausgang", "1lBMAX7eFKKuH0gBnBRDUODIq7AXMnBmJ", "ausgang", "2026", "02"),
    WorkflowWatch("maerz-2026-ausgang", "März 2026 - Ausgang", "1Iqpsed-3jJZ50kp4VHV8UjGZGW8zrQJp", "ausgang", "2026", "03"),
    WorkflowWatch("april-2026-ausgang", "April 2026 - Ausgang", "1ozRkNLv1nOfP2blw2FGQPvWLM76dZ47b", "ausgang", "2026", "04"),
    WorkflowWatch("mai-2026-ausgang", "Mai 2026 - Ausgang", "1BFtJNaAvqDZx_tyBV8E2m2neoLHy1Vzq", "ausgang", "2026", "05"),
    WorkflowWatch("juni-2026-ausgang", "Juni 2026 - Ausgang", "1dJ0XimSO3b9Xrw8oArA7JlgaTZwZFXvr", "ausgang", "2026", "06"),
    WorkflowWatch("juli-2026-ausgang", "Juli 2026 - Ausgang", "1i-NF5cNAe9ZIsCeEawpSmNNcnyHK0gLh", "ausgang", "2026", "07"),
    WorkflowWatch("august-2026-ausgang", "August 2026 - Ausgang", "1YjJR3bPzX-OR32aBj1jd8y3Sc9Pom9kF", "ausgang", "2026", "08"),
    WorkflowWatch("september-2026-ausgang", "September 2026 - Ausgang", "1Nq0KT4YuUS6JIvEFMdmAkqdmAhE4t560", "ausgang", "2026", "09"),
    WorkflowWatch("oktober-2026-ausgang", "Oktober 2026 - Ausgang", "1fVOjeG0bUd2UQi8aY7b3EouTxj22VVN0", "ausgang", "2026", "10"),
    WorkflowWatch("november-2026-ausgang", "November 2026 - Ausgang", "1g1fUOJWSmkE-LgoIuj8JFuJxDE5lEVBk", "ausgang", "2026", "11"),
    WorkflowWatch("dezember-2026-ausgang", "Dezember 2026 - Ausgang", "1B-9XbIZ1jxpHDgVY8UVI5oX9tTN7b0Na", "ausgang", "2026", "12"),
    WorkflowWatch("volksbank", "Volksbank 2026", "1AL5mxd5v07F6mLIuyDQfXBvf5Khw7j7M", "vrbank", "2026", None),
    WorkflowWatch("amex", "AMEX 2026", "1AMkqKj-umQNEAxzVd4B7hR5PHsycw_G6", "amex", "2026", None),
    WorkflowWatch("kasse", "Kasse 2026", "1h-muKvOuOznzulezd-NGK68yaC6QqpgW", "kasse", "2026", None),
    WorkflowWatch("provisionsabrechnungen", "Provisionsabrechnungen 2026", "14UgPdSLR05NkkJQN80iM7lZmN_4HW2BJ", "provision", "2026", None),

    # ----- 2027 -----
    WorkflowWatch("januar-2027-eingang", "Januar 2027 - Eingang", "1h8Voy-YA4e9BgZEmo4nv-ZWgaWAd292Q", "eingang", "2027", "01"),
    WorkflowWatch("februar-2027-eingang", "Februar 2027 - Eingang", "1LFvRilyEOj5bu-xQjIKVcdy0DE9TGH4u", "eingang", "2027", "02"),
    WorkflowWatch("maerz-2027-eingang", "März 2027 - Eingang", "1Kl8QkVT30FdhGxsdoX9AWajjIvTyHX1i", "eingang", "2027", "03"),
    WorkflowWatch("april-2027-eingang", "April 2027 - Eingang", "1_zJz2WNa35JBw6KAi4KvJMcDtgk4YJwE", "eingang", "2027", "04"),
    WorkflowWatch("mai-2027-eingang", "Mai 2027 - Eingang", "1zZ3_XQl0SNvWMbMHOFulBT_Pqj664FBC", "eingang", "2027", "05"),
    WorkflowWatch("juni-2027-eingang", "Juni 2027 - Eingang", "1gJu0ol5aLqm5mRiyB5h7kr5RsEbksPnY", "eingang", "2027", "06"),
    WorkflowWatch("juli-2027-eingang", "Juli 2027 - Eingang", "1yvbfMXCjZ3RInfqYNCePu0Almoq2WqRN", "eingang", "2027", "07"),
    WorkflowWatch("august-2027-eingang", "August 2027 - Eingang", "12RKonKb-lo5EhrzuD_pp0-DGsk7Pbqlh", "eingang", "2027", "08"),
    WorkflowWatch("september-2027-eingang", "September 2027 - Eingang", "1Kihfb7SJt2YPIg8VJ4qUmdT945z8oYJ-", "eingang", "2027", "09"),
    WorkflowWatch("oktober-2027-eingang", "Oktober 2027 - Eingang", "1VcOZF1d0L3j6Gfq_hImEdCUtWVC2eo-5", "eingang", "2027", "10"),
    WorkflowWatch("november-2027-eingang", "November 2027 - Eingang", "1qt-1E_BtBrx0UkHkOjwFs5OcpLf-CcRV", "eingang", "2027", "11"),
    WorkflowWatch("dezember-2027-eingang", "Dezember 2027 - Eingang", "1dJOUr3arrQ2VgfP3rmUO_NrECCEpf_kd", "eingang", "2027", "12"),
    WorkflowWatch("januar-2027-ausgang", "Januar 2027 - Ausgang", "1eP6pSLrA3RSaQt62lKl8ZlaJvuQ3dP_P", "ausgang", "2027", "01"),
    WorkflowWatch("februar-2027-ausgang", "Februar 2027 - Ausgang", "18lyb_eikNCaAtY0VhcLL23O874UlB_x4", "ausgang", "2027", "02"),
    WorkflowWatch("maerz-2027-ausgang", "März 2027 - Ausgang", "1jSAu1NuAXCacdVtdPJR-gO8e1n7D4F97", "ausgang", "2027", "03"),
    WorkflowWatch("april-2027-ausgang", "April 2027 - Ausgang", "1HfBg72s9MC01-41Rx-CI8dcGg-JGOsUr", "ausgang", "2027", "04"),
    WorkflowWatch("mai-2027-ausgang", "Mai 2027 - Ausgang", "1CGNQsC4EV3Wm8FGI6-BeIlc-RPhwbpkK", "ausgang", "2027", "05"),
    WorkflowWatch("juni-2027-ausgang", "Juni 2027 - Ausgang", "1f3D7IXDMeRMIZxRArdDevEqB3s6_gyXY", "ausgang", "2027", "06"),
    WorkflowWatch("juli-2027-ausgang", "Juli 2027 - Ausgang", "1JHruRoLlMCPtkfiPEbnuygXcwaXaCirl", "ausgang", "2027", "07"),
    WorkflowWatch("august-2027-ausgang", "August 2027 - Ausgang", "1aKBo16-GZ6PW-oqf_hHJs1FSUNJRgqd4", "ausgang", "2027", "08"),
    WorkflowWatch("september-2027-ausgang", "September 2027 - Ausgang", "1lTRD1zR-xYTtKGbtdMNli6LfchYRaj9J", "ausgang", "2027", "09"),
    WorkflowWatch("oktober-2027-ausgang", "Oktober 2027 - Ausgang", "1kfjN-5NrITZiKaZgrow_BXOySuftrsmo", "ausgang", "2027", "10"),
    WorkflowWatch("november-2027-ausgang", "November 2027 - Ausgang", "14Wjr4BmrPYs3sq_rY31ryHVobqMLOUE0", "ausgang", "2027", "11"),
    WorkflowWatch("dezember-2027-ausgang", "Dezember 2027 - Ausgang", "1NLW7y8a_IERMkCqZEc3C4ind4nwLAUPh", "ausgang", "2027", "12"),
    WorkflowWatch("volksbank-2027", "Volksbank 2027", "1IiIVZ5Nd2HfQqRgUBbYS59FE3Ai3oYny", "vrbank", "2027", None),
    WorkflowWatch("amex-2027", "AMEX 2027", "1juuaG9csKDJ82Xfyt6U9HvOxJeVutPPO", "amex", "2027", None),
    WorkflowWatch("kasse-2027", "Kasse 2027", "1vjXyQhYlrRpBjFAG-oX5M0jwDpHNKctN", "kasse", "2027", None),
    WorkflowWatch("provisionsabrechnungen-2027", "Provisionsabrechnungen 2027", "15yH78273hwcVBe8onk8Z7-bxGe8fkWZv", "provision", "2027", None),
]
