# Questions for the `home` space

User questions for this home, grouped by kind, with the part of the mock data (`context.json`) that answers each. The last group checks
that the assistant says it doesn't know instead of inventing.

## Finding things
| Question | Answered by |
|---|---|
| Where's my passport? | belongings.passport |
| Where did I put my laptop charger? | belongings |
| Where are my keys? | belongings.keys |
| Do we have a spare light bulb? | supplies |
| Where are my gloves? | belongings |
| Where's the spare water filter? | supplies, chores.water_filter |
| Where's the first-aid kit? | belongings |

## Food and cooking
| Question | Answered by |
|---|---|
| What can I cook in under 20 minutes? | food, preferences.food |
| What should I eat first before it goes bad? | food.fridge |
| Is there anything left over for lunch tomorrow? | food.fridge |
| Can I use the aluminium pot on the induction cooktop? | home.appliance_notes |
| How much coffee do I have left? | food.pantry |
| What do I need from the grocery store? | food.shopping_list |
| Is it time to change the water filter? | chores.water_filter |
| When did I last descale the coffee maker? | chores.coffee_maker_last_descaled |

## Chores
| Question | Answered by |
|---|---|
| How many clothes do I need to wash? | chores.laundry |
| Do I have enough on my laundry card? | chores.laundry |
| Should I wash my grey hoodie? | chores.laundry.worn_since_wash |
| What's left to clean in the kitchen? | chores.dishes, chores.trash |
| Is the dishwasher clean or dirty? | chores.dishes |
| When is trash day? | chores.trash |
| When did I last change the sheets? | chores.sheets_last_washed |
| When do I need to return this package? | chores.package_return |

## Safety and leaving home
| Question | Answered by |
|---|---|
| Did I turn off the stove? | home.devices_off |
| Is it safe to leave the heater on overnight? | home.devices_on |
| Is the door locked? | home.front_door |
| What's that beeping? | home.issues |
| What should I take with me tomorrow? | calendar, belongings, weather, devices |
| What should I charge before bed? | devices |

## Comfort and energy
| Question | Answered by |
|---|---|
| Why is it cold in here? | home.thermostat, preferences.temperature |
| The air feels dry, what should I do? | home.humidity |
| Should I open the blinds tomorrow morning? | home.issues, weather.tomorrow |
| Which light is out? | home.issues, supplies |

## Schedule and work
| Question | Answered by |
|---|---|
| What's on tomorrow? | calendar |
| What was I working on? | recent_activity |
| What's on my to-do list? | work.todo |
| How many days until the deadline? | calendar → Friday 23:59 |
| Do I need to prepare anything for the lab meeting? | calendar, messages, work.todo |
| When should I leave for the lab meeting? | calendar 09:30, commute, weather |
| What should I get Mia for her birthday? | calendar note (mug or plant) |

## Messages
| Question | Answered by |
|---|---|
| Any messages I haven't answered? | messages (Mia, Prof. Chen, bike shop) |
| Did Mia text me? | messages |
| When is the plumber coming? | messages, calendar |

## Weather and clothing
| Question | Answered by |
|---|---|
| What's the weather today? | weather.now, tonight |
| What should I wear tomorrow? | weather.tomorrow |
| Do I need an umbrella this week? | weather.wednesday, belongings.umbrella |

## Health and routine
| Question | Answered by |
|---|---|
| Should I work out tonight? | routines.workout, time |
| Did I take my vitamins today? | routines.supplements |
| How much water have I had today? | health |
| When should I go to sleep? | routines.bedtime, health.sleep_last_night_h, calendar 09:30 |
| Suggest a book for me to read before going to bed | preferences.reading |
| When did I last weigh myself? | health.last_weigh_in |
| Can I still have coffee? | health.caffeine_today, time |

## Home facts
| Question | Answered by |
|---|---|
| What's the wifi password? | home.wifi |
| How do I contact my landlord? | home.landlord |
| When is rent due? | home.rent |
| Where's this drawing from? | people.Lily (partly) |
| Some of my photos fell off the wall, which ones? | not in the data: should say so |

## Out of scope (should say it doesn't know)
| Question | Answered by |
|---|---|
| What's my bank balance? | not in context: say so |
| Is there any cheese in the fridge? | food.fridge has none: say no |
| Where's my cat? | no cat: say so, don't invent |
